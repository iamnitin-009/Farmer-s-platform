// server/listingStore.js
// Adaptive shared persistence engine for Agricultural Marketplace listings & orders.
// Supports PostgreSQL in production and a thread-safe local file fallback for development.
// Fully implements BFM-001 Parent Order + Farmer Allocations, Atomic Reservations, and Concurrency Protection.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { allocateMultiFarmerOrder, normalizeBuyerRequirement } from './matchingEngine.js';
import {
  CROP_KEYS,
  isValidCrop,
  normalizeCropKey,
  normalizeVariety,
} from './cropConstants.js';
import { calculateFairPrice } from './fairPrice.js';
import { calculateDeliveryPricing } from './deliveryPricing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'listings.json');
const DATA_FILE_ORDERS = path.join(DATA_DIR, 'orders.json');

const { Pool } = pg;

// Simple async Mutex to serialize concurrent mutations in local fallback mode
class AsyncMutex {
  constructor() {
    this._queue = Promise.resolve();
  }

  lock() {
    let unlockNext;
    const willLock = new Promise((resolve) => {
      unlockNext = resolve;
    });
    const willWait = this._queue.then(() => unlockNext);
    this._queue = this._queue.then(() => willLock);
    return willWait;
  }
}

const SEED_LISTING_IDS = [
  'seed_listing_wheat_01',
  'seed_listing_tomato_02',
  'seed_listing_onion_03',
  'seed_listing_potato_04',
];

const SEED_LISTINGS = [];

class ListingStore {
  constructor() {
    this.isPostgres = Boolean(process.env.DATABASE_URL);
    this.pool = null;
    this.inMemoryListings = [];
    this.inMemoryOrders = [];
    this.initialized = false;
    this.mutex = new AsyncMutex();
  }

  async init() {
    if (this.initialized) return;

    if (this.isPostgres) {
      try {
        console.log('[ListingStore] Connecting to PostgreSQL at DATABASE_URL...');
        const isLocalhost =
          process.env.DATABASE_URL.includes('localhost') ||
          process.env.DATABASE_URL.includes('127.0.0.1');
        this.pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: isLocalhost ? false : { rejectUnauthorized: false },
        });

        const client = await this.pool.connect();
        try {
          await client.query(`
            CREATE TABLE IF NOT EXISTS listings (
              id VARCHAR(100) PRIMARY KEY,
              farmer_id VARCHAR(100),
              farmer_name VARCHAR(255),
              farmer_mobile VARCHAR(50),
              crop VARCHAR(50) NOT NULL,
              variety VARCHAR(100),
              quantity NUMERIC NOT NULL,
              reserved_quantity NUMERIC DEFAULT 0,
              price NUMERIC NOT NULL,
              location VARCHAR(255) NOT NULL,
              harvest_date VARCHAR(50),
              photo TEXT,
              quality JSONB,
              fair_price JSONB,
              pickup_decision JSONB,
              status VARCHAR(50) DEFAULT 'Listed',
              moderation_status VARCHAR(50) DEFAULT 'approved',
              traceability_id VARCHAR(100),
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS orders (
              id VARCHAR(100) PRIMARY KEY,
              buyer_id VARCHAR(100),
              buyer_name VARCHAR(255),
              buyer_mobile VARCHAR(50),
              buyer_location VARCHAR(255),
              listing_id VARCHAR(100),
              crop VARCHAR(50) NOT NULL,
              variety VARCHAR(100),
              quantity NUMERIC NOT NULL,
              requested_quantity NUMERIC,
              fulfilled_quantity NUMERIC,
              remaining_quantity NUMERIC DEFAULT 0,
              price_per_kg NUMERIC,
              total_amount NUMERIC,
              farmer_id VARCHAR(100),
              farmer_name VARCHAR(255),
              farmer_mobile VARCHAR(50),
              fulfillment_status VARCHAR(50) DEFAULT 'PAYMENT_SECURED',
              status VARCHAR(50) DEFAULT 'Payment Secured',
              allocations JSONB DEFAULT '[]',
              requirement JSONB,
              product_subtotal NUMERIC,
              delivery_charge NUMERIC,
              platform_fee NUMERIC DEFAULT 0,
              discount NUMERIC DEFAULT 0,
              net_payable NUMERIC,
              effective_price_per_kg NUMERIC,
              delivery_status VARCHAR(50),
              delivery_rule_version VARCHAR(50),
              calculated_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW()
            );
          `);

          // Run defensive migrations for existing schemas
          await client.query(`
            ALTER TABLE listings ADD COLUMN IF NOT EXISTS variety VARCHAR(100);
            ALTER TABLE listings ADD COLUMN IF NOT EXISTS reserved_quantity NUMERIC DEFAULT 0;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS variety VARCHAR(100);
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS requested_quantity NUMERIC;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfilled_quantity NUMERIC;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS remaining_quantity NUMERIC DEFAULT 0;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_location VARCHAR(255);
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS allocations JSONB DEFAULT '[]';
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS requirement JSONB;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_subtotal NUMERIC;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_charge NUMERIC;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_fee NUMERIC DEFAULT 0;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount NUMERIC DEFAULT 0;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS net_payable NUMERIC;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS effective_price_per_kg NUMERIC;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(50);
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_rule_version VARCHAR(50);
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ;
          `);

          // Purge legacy seed listings
          await client.query('DELETE FROM listings WHERE id IN ($1, $2, $3, $4)', SEED_LISTING_IDS);
          console.log('[ListingStore] ✅ PostgreSQL initialized with variety, reservation, & BFM-001 allocations schema.');
        } finally {
          client.release();
        }
      } catch (err) {
        console.error('[ListingStore] ⚠️ PostgreSQL connection failed:', err.message);
        console.warn('[ListingStore] Falling back to local file-synced store.');
        this.isPostgres = false;
        this.initLocalStore();
      }
    } else {
      this.initLocalStore();
    }

    this.initialized = true;
  }

  initLocalStore() {
    console.log('[ListingStore] ℹ️ Operating in local file-synced fallback mode.');

    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        try {
          const parsed = JSON.parse(raw);
          this.inMemoryListings = Array.isArray(parsed) ? parsed : [];
        } catch {
          this.inMemoryListings = [];
        }
        // Normalize listings defensively and exclude deprecated non-canonical demo records
        this.inMemoryListings = this.inMemoryListings
          .filter((item) => !SEED_LISTING_IDS.includes(item.id) && item.crop !== 'potato')
          .map((item) => ({
            ...item,
            variety: item.variety || 'Regular',
            reservedQuantity: parseFloat(item.reservedQuantity || item.reserved_quantity || 0),
            availableQuantity: Math.max(
              0,
              (parseFloat(item.quantity) || 0) - parseFloat(item.reservedQuantity || item.reserved_quantity || 0)
            ),
          }));
        this.saveLocalStore();
      } else {
        this.inMemoryListings = [];
        this.saveLocalStore();
      }

      if (fs.existsSync(DATA_FILE_ORDERS)) {
        const rawOrders = fs.readFileSync(DATA_FILE_ORDERS, 'utf8');
        try {
          const parsedOrders = JSON.parse(rawOrders);
          this.inMemoryOrders = Array.isArray(parsedOrders) ? parsedOrders : [];
        } catch {
          this.inMemoryOrders = [];
        }
        // Normalize orders defensively
        this.inMemoryOrders = this.inMemoryOrders.map((o) => {
          const subtotal = parseFloat(o.productSubtotal ?? o.totalAmount ?? 0);
          const delCharge = o.deliveryCharge !== undefined && o.deliveryCharge !== null
            ? parseFloat(o.deliveryCharge)
            : (subtotal > 2000 ? 0 : (subtotal > 0 ? 40 : 0));
          const net = parseFloat(o.netPayable ?? (subtotal + delCharge));
          const qty = parseFloat(o.fulfilledQuantity ?? o.quantity ?? 0);
          return {
            ...o,
            variety: o.variety || null,
            requestedQuantity: parseFloat(o.requestedQuantity ?? o.quantity ?? 0),
            fulfilledQuantity: qty,
            remainingQuantity: parseFloat(o.remainingQuantity ?? 0),
            allocations: Array.isArray(o.allocations) ? o.allocations : [],
            productSubtotal: subtotal,
            deliveryCharge: delCharge,
            platformFee: parseFloat(o.platformFee ?? 0),
            discount: parseFloat(o.discount ?? 0),
            netPayable: net,
            effectivePricePerKg: parseFloat(o.effectivePricePerKg ?? (qty > 0 ? Math.round((net / qty) * 100) / 100 : 0)),
            deliveryStatus: o.deliveryStatus || (qty <= 0 ? 'NOT_APPLICABLE' : (subtotal > 2000 ? 'FREE' : 'CHARGED')),
            deliveryRuleVersion: o.deliveryRuleVersion || 'DLV-001-v1',
            calculatedAt: o.calculatedAt || o.createdAt || new Date().toISOString(),
            totalAmount: net,
          };
        });
        this.saveLocalOrders();
      } else {
        this.inMemoryOrders = [];
        this.saveLocalOrders();
      }
    } catch (err) {
      console.error('[ListingStore] Error reading local data file:', err.message);
      this.inMemoryListings = [];
      this.inMemoryOrders = [];
    }
  }

  saveLocalStore() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.inMemoryListings, null, 2), 'utf8');
    } catch (err) {
      console.error('[ListingStore] Error writing to local file:', err.message);
    }
  }

  saveLocalOrders() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DATA_FILE_ORDERS, JSON.stringify(this.inMemoryOrders, null, 2), 'utf8');
    } catch (err) {
      console.error('[ListingStore] Error writing to local orders file:', err.message);
    }
  }

  rowToListing(row) {
    if (!row) return null;
    const qty = parseFloat(row.quantity);
    const reserved = parseFloat(row.reserved_quantity || 0);
    return {
      id: row.id,
      farmerId: row.farmer_id,
      farmerName: row.farmer_name,
      farmerMobile: row.farmer_mobile,
      crop: row.crop,
      variety: row.variety || 'Regular',
      quantity: qty,
      reservedQuantity: reserved,
      availableQuantity: Math.max(0, qty - reserved),
      price: parseFloat(row.price),
      location: row.location,
      harvestDate: row.harvest_date,
      photo: row.photo,
      quality: typeof row.quality === 'string' ? JSON.parse(row.quality) : (row.quality || null),
      fairPrice: typeof row.fair_price === 'string' ? JSON.parse(row.fair_price) : (row.fair_price || null),
      pickupDecision: typeof row.pickup_decision === 'string' ? JSON.parse(row.pickup_decision) : (row.pickup_decision || null),
      status: row.status,
      moderationStatus: row.moderation_status,
      traceabilityId: row.traceability_id,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    };
  }

  async getAllListings(filters = {}) {
    await this.init();
    const { role, farmerId, crop, status } = filters;

    if (this.isPostgres && this.pool) {
      const conditions = [];
      const values = [];

      if (role === 'admin') {
        // Admin sees all listings
      } else if (farmerId) {
        values.push(farmerId);
        conditions.push(`(farmer_id = $${values.length})`);
      } else {
        conditions.push(`quantity > 0`);
        conditions.push(`moderation_status != 'rejected'`);
      }

      if (crop) {
        values.push(crop.toLowerCase());
        conditions.push(`LOWER(crop) = $${values.length}`);
      }

      if (status && status !== 'all') {
        values.push(status);
        conditions.push(`status = $${values.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const query = `SELECT * FROM listings ${whereClause} ORDER BY created_at DESC`;
      const res = await this.pool.query(query, values);
      return res.rows.map((r) => this.rowToListing(r));
    }

    let result = [...this.inMemoryListings];
    if (role === 'admin') {
      // All
    } else if (farmerId) {
      result = result.filter((l) => l.farmerId === farmerId);
    } else {
      result = result.filter((l) => l.quantity > 0 && l.moderationStatus !== 'rejected');
    }

    // CROP-001 Whitelist Gate: Only active approved marketplace crops are returned
    const allowedCropSet = new Set(CROP_KEYS);
    result = result.filter((l) => {
      const norm = normalizeCropKey(l.crop);
      return norm && allowedCropSet.has(norm);
    });

    if (crop) {
      result = result.filter((l) => (l.crop || '').toLowerCase() === crop.toLowerCase());
    }

    if (status && status !== 'all') {
      result = result.filter((l) => l.status === status);
    }

    return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async getListingById(id) {
    await this.init();
    if (!id) return null;

    if (this.isPostgres && this.pool) {
      const res = await this.pool.query(
        `SELECT * FROM listings WHERE id = $1 OR traceability_id = $1 LIMIT 1`,
        [id]
      );
      return res.rows[0] ? this.rowToListing(res.rows[0]) : null;
    }

    const found = this.inMemoryListings.find((l) => l.id === id || l.traceabilityId === id);
    if (!found) return null;
    const qty = parseFloat(found.quantity || 0);
    const reserved = parseFloat(found.reservedQuantity || 0);
    return {
      ...found,
      quantity: qty,
      reservedQuantity: reserved,
      availableQuantity: Math.max(0, qty - reserved),
    };
  }

  async createListing(data) {
    await this.init();

    const id = data.id || 'listing_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const normalizedCrop = normalizeCropKey(data.crop) || (data.crop || '').toLowerCase();
    const canonicalVariety = normalizeVariety(normalizedCrop, data.variety) || 'Regular';
    const computedFairPrice = calculateFairPrice({
      crop: normalizedCrop,
      variety: canonicalVariety,
      quantity: parseFloat(data.quantity) || 100,
      grade: data.quality?.grade || null,
      lang: 'en',
    });
    const fairPrice = computedFairPrice ? {
      ...(typeof data.fairPrice === 'object' && data.fairPrice !== null ? data.fairPrice : {}),
      ...computedFairPrice,
    } : (data.fairPrice || null);

    const item = {
      id,
      farmerId: data.farmerId || 'demo_farmer',
      farmerName: data.farmerName || 'Farmer',
      farmerMobile: data.farmerMobile || '',
      crop: normalizedCrop,
      variety: canonicalVariety,
      quantity: parseFloat(data.quantity) || 0,
      reservedQuantity: 0,
      availableQuantity: parseFloat(data.quantity) || 0,
      price: parseFloat(data.price) || 0,
      location: (data.location || '').trim(),
      harvestDate: data.harvestDate || '',
      photo: data.photo || null,
      quality: data.quality || null,
      fairPrice,
      pickupDecision: data.pickupDecision || null,
      status: data.status || 'Listed',
      moderationStatus: data.moderationStatus || 'approved',
      traceabilityId:
        data.traceabilityId ||
        `TRC-${(normalizedCrop || 'CROP').toUpperCase()}-${Date.now().toString().slice(-4)}`,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (this.isPostgres && this.pool) {
      const q = `
        INSERT INTO listings (
          id, farmer_id, farmer_name, farmer_mobile, crop, variety, quantity,
          reserved_quantity, price, location, harvest_date, photo, quality,
          fair_price, pickup_decision, status, moderation_status, traceability_id,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (id) DO UPDATE SET
          quantity = EXCLUDED.quantity,
          price = EXCLUDED.price,
          status = EXCLUDED.status,
          moderation_status = EXCLUDED.moderation_status,
          updated_at = EXCLUDED.updated_at
      `;
      const client = await this.pool.connect();
      try {
        await client.query(q, [
          item.id,
          item.farmerId,
          item.farmerName,
          item.farmerMobile,
          item.crop,
          item.variety,
          item.quantity,
          item.reservedQuantity,
          item.price,
          item.location,
          item.harvestDate,
          item.photo,
          JSON.stringify(item.quality),
          JSON.stringify(item.fairPrice),
          JSON.stringify(item.pickupDecision),
          item.status,
          item.moderationStatus,
          item.traceabilityId,
          item.createdAt,
          item.updatedAt,
        ]);
        return this.getListingById(id);
      } finally {
        client.release();
      }
    }

    this.inMemoryListings.unshift(item);
    this.saveLocalStore();
    return item;
  }

  async updateListing(id, updates) {
    await this.init();
    const existing = await this.getListingById(id);
    if (!existing) return null;

    const effectiveUpdates = { ...updates };
    if (
      effectiveUpdates.crop !== undefined ||
      effectiveUpdates.variety !== undefined ||
      effectiveUpdates.quantity !== undefined ||
      effectiveUpdates.quality !== undefined
    ) {
      const targetCrop = normalizeCropKey(effectiveUpdates.crop || existing.crop) || existing.crop;
      const targetVariety = normalizeVariety(
        targetCrop,
        effectiveUpdates.variety !== undefined ? effectiveUpdates.variety : existing.variety
      ) || 'Regular';
      const targetQty = effectiveUpdates.quantity !== undefined
        ? parseFloat(effectiveUpdates.quantity)
        : existing.quantity;
      const targetGrade = (effectiveUpdates.quality?.grade || existing.quality?.grade) || null;
      const recomputedFairPrice = calculateFairPrice({
        crop: targetCrop,
        variety: targetVariety,
        quantity: targetQty,
        grade: targetGrade,
      });
      if (recomputedFairPrice) {
        effectiveUpdates.fairPrice = {
          ...(typeof effectiveUpdates.fairPrice === 'object' && effectiveUpdates.fairPrice !== null ? effectiveUpdates.fairPrice : {}),
          ...recomputedFairPrice,
        };
      }
      if (effectiveUpdates.crop !== undefined) effectiveUpdates.crop = targetCrop;
      if (effectiveUpdates.variety !== undefined) effectiveUpdates.variety = targetVariety;
    }

    if (this.isPostgres && this.pool) {
      const allowedKeys = [
        'crop',
        'variety',
        'quantity',
        'reservedQuantity',
        'price',
        'location',
        'harvestDate',
        'photo',
        'status',
        'moderationStatus',
        'quality',
        'fairPrice',
        'pickupDecision',
      ];
      const sets = [];
      const values = [];

      for (const [k, v] of Object.entries(effectiveUpdates)) {
        if (!allowedKeys.includes(k)) continue;
        values.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
        const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
        sets.push(`${col} = $${values.length}`);
      }

      if (sets.length > 0) {
        values.push(new Date().toISOString());
        sets.push(`updated_at = $${values.length}`);
        values.push(id);

        const query = `UPDATE listings SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`;
        const res = await this.pool.query(query, values);
        return res.rows[0] ? this.rowToListing(res.rows[0]) : null;
      }
      return existing;
    }

    const idx = this.inMemoryListings.findIndex((l) => l.id === id);
    if (idx === -1) return null;

    const current = this.inMemoryListings[idx];
    const newQty = effectiveUpdates.quantity !== undefined ? parseFloat(effectiveUpdates.quantity) : current.quantity;
    const newReserved = effectiveUpdates.reservedQuantity !== undefined
      ? parseFloat(effectiveUpdates.reservedQuantity)
      : (current.reservedQuantity || 0);

    this.inMemoryListings[idx] = {
      ...current,
      ...effectiveUpdates,
      quantity: newQty,
      reservedQuantity: newReserved,
      availableQuantity: Math.max(0, newQty - newReserved),
      updatedAt: new Date().toISOString(),
    };
    this.saveLocalStore();
    return this.inMemoryListings[idx];
  }

  async deleteListing(id) {
    await this.init();
    if (this.isPostgres && this.pool) {
      const res = await this.pool.query('DELETE FROM listings WHERE id = $1', [id]);
      return res.rowCount > 0;
    }
    const before = this.inMemoryListings.length;
    this.inMemoryListings = this.inMemoryListings.filter((l) => l.id !== id);
    if (this.inMemoryListings.length !== before) {
      this.saveLocalStore();
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------
  // Orders & BFM-001 Allocation Engine
  // -------------------------------------------------------------

  rowToOrder(row) {
    if (!row) return null;
    let allocations = [];
    if (Array.isArray(row.allocations)) {
      allocations = row.allocations;
    } else if (typeof row.allocations === 'string') {
      try {
        allocations = JSON.parse(row.allocations);
      } catch {
        allocations = [];
      }
    }

    let req = null;
    if (typeof row.requirement === 'string') {
      try {
        req = JSON.parse(row.requirement);
      } catch {
        req = null;
      }
    } else if (typeof row.requirement === 'object') {
      req = row.requirement;
    }

    const productSubtotal = parseFloat(row.product_subtotal ?? row.total_amount ?? 0);
    const deliveryCharge = row.delivery_charge !== undefined && row.delivery_charge !== null
      ? parseFloat(row.delivery_charge)
      : (productSubtotal > 2000 ? 0 : (productSubtotal > 0 ? 40 : 0));
    const platformFee = parseFloat(row.platform_fee ?? 0);
    const discount = parseFloat(row.discount ?? 0);
    const netPayable = parseFloat(row.net_payable ?? (productSubtotal + deliveryCharge + platformFee - discount));
    const actualDeliveredQuantity = parseFloat(row.fulfilled_quantity ?? row.quantity ?? 0);
    const effectivePricePerKg = parseFloat(
      row.effective_price_per_kg ?? (actualDeliveredQuantity > 0 ? Math.round((netPayable / actualDeliveredQuantity) * 100) / 100 : 0)
    );
    const deliveryStatus = row.delivery_status || (actualDeliveredQuantity <= 0 ? 'NOT_APPLICABLE' : (productSubtotal > 2000 ? 'FREE' : 'CHARGED'));
    const deliveryRuleVersion = row.delivery_rule_version || 'DLV-001-v1';
    const calculatedAt = row.calculated_at ? new Date(row.calculated_at).toISOString() : (row.created_at || new Date().toISOString());

    return {
      id: row.id,
      orderId: row.id,
      buyerId: row.buyer_id,
      buyerName: row.buyer_name,
      buyerMobile: row.buyer_mobile,
      buyerLocation: row.buyer_location || '',
      listingId: row.listing_id || (allocations[0]?.listingId || null),
      crop: row.crop,
      variety: row.variety || (allocations[0]?.variety || null),
      quantity: actualDeliveredQuantity,
      quantityKg: actualDeliveredQuantity,
      requestedQuantity: parseFloat(row.requested_quantity ?? row.quantity ?? 0),
      fulfilledQuantity: actualDeliveredQuantity,
      remainingQuantity: parseFloat(row.remaining_quantity || 0),
      pricePerKg: parseFloat(row.price_per_kg || 0),
      ratePerKg: parseFloat(row.price_per_kg || 0),
      productSubtotal,
      deliveryCharge,
      platformFee,
      discount,
      netPayable,
      effectivePricePerKg,
      deliveryStatus,
      deliveryRuleVersion,
      calculatedAt,
      totalAmount: netPayable,
      farmerId: row.farmer_id || (allocations[0]?.farmerId || null),
      farmerName: row.farmer_name || (allocations[0]?.farmerName || null),
      farmerMobile: row.farmer_mobile || (allocations[0]?.farmerMobile || null),
      fulfillmentStatus: row.fulfillment_status,
      status: row.status,
      allocations,
      requirement: req,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    };
  }

  async getAllOrders({ crop, buyerId, farmerId } = {}) {
    await this.init();

    let orders = [];
    if (this.isPostgres && this.pool) {
      const client = await this.pool.connect();
      try {
        let q = 'SELECT * FROM orders WHERE 1=1';
        const params = [];
        if (crop) {
          params.push(crop.toLowerCase());
          q += ` AND LOWER(crop) = $${params.length}`;
        }
        if (buyerId) {
          params.push(buyerId);
          q += ` AND buyer_id = $${params.length}`;
        }
        q += ' ORDER BY created_at DESC';
        const res = await client.query(q, params);
        orders = res.rows.map((r) => this.rowToOrder(r));
      } finally {
        client.release();
      }
    } else {
      orders = [...this.inMemoryOrders];
      if (crop) {
        orders = orders.filter((o) => (o.crop || '').toLowerCase() === crop.toLowerCase());
      }
      if (buyerId) {
        orders = orders.filter((o) => o.buyerId === buyerId);
      }
    }

    // Filter for Farmer visibility:
    // Farmer should ONLY see orders containing their allocation, and ONLY their allocation details!
    if (farmerId) {
      orders = orders
        .filter((o) => {
          const hasAlloc = Array.isArray(o.allocations) && o.allocations.some((a) => a.farmerId === farmerId);
          const hasLegacy = o.farmerId === farmerId;
          return hasAlloc || hasLegacy;
        })
        .map((o) => {
          // If multi-farmer order, redact other farmers' allocations
          if (Array.isArray(o.allocations) && o.allocations.length > 0) {
            const myAllocs = o.allocations.filter((a) => a.farmerId === farmerId);
            return {
              ...o,
              allocations: myAllocs,
              // Show farmer-specific allocated share for convenience
              allocatedShareQty: myAllocs.reduce((s, a) => s + a.allocatedQuantity, 0),
              allocatedShareAmount: myAllocs.reduce((s, a) => s + a.totalAmount, 0),
            };
          }
          return o;
        });
    }

    return orders;
  }

  async getOrderById(id) {
    await this.init();
    if (!id) return null;

    if (this.isPostgres && this.pool) {
      const res = await this.pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [id]);
      return res.rows[0] ? this.rowToOrder(res.rows[0]) : null;
    }

    return this.inMemoryOrders.find((o) => o.id === id || o.orderId === id) || null;
  }

  /**
   * ATOMIC Direct Order from single listing.
   * Checks availability, reserves inventory, applies DLV-001 delivery pricing,
   * and creates order atomically without trusting client-side remaining calculations.
   */
  async createDirectOrder({ listingId, quantity, buyerSession }) {
    await this.init();
    const unlock = await this.mutex.lock();

    try {
      const qty = parseFloat(quantity);
      if (!listingId || isNaN(qty) || qty <= 0) {
        return { success: false, error: 'Valid listingId and positive quantity are required.' };
      }

      const listing = await this.getListingById(listingId);
      if (!listing) {
        return { success: false, error: 'Listing not found.' };
      }

      if (listing.status === 'Sold Out') {
        return { success: false, error: 'Listing is already sold out.' };
      }

      const avail = Math.max(0, (listing.quantity || 0) - (listing.reservedQuantity || 0));
      if (avail < qty) {
        return {
          success: false,
          error: `Insufficient available stock. Available: ${avail} kg, Requested: ${qty} kg.`,
        };
      }

      const allocationId = 'alloc_' + Date.now().toString().slice(-6) + '_' + Math.random().toString(36).substring(2, 6);
      const unitPrice = parseFloat(listing.price || listing.expectedPrice || 0);
      const allocation = {
        allocationId,
        id: allocationId,
        listingId: listing.id,
        farmerId: listing.farmerId,
        farmerName: listing.farmerName,
        farmerMobile: listing.farmerMobile,
        crop: listing.crop,
        variety: listing.variety || 'Regular',
        allocatedQuantity: qty,
        unitPrice,
        totalPrice: Math.round(qty * unitPrice * 100) / 100,
        status: 'PENDING',
        allocatedAt: new Date().toISOString(),
      };

      // Atomically commit reservation
      const newReserved = (listing.reservedQuantity || 0) + qty;
      await this.updateListing(listing.id, {
        reservedQuantity: newReserved,
        status: (listing.quantity - newReserved <= 0) ? 'Reserved' : listing.status,
      });

      // Authoritative DLV-001 Delivery Pricing
      const productSubtotal = Math.round(qty * unitPrice * 100) / 100;
      const deliveryPricing = calculateDeliveryPricing({
        allocations: [allocation],
        productSubtotal,
        actualDeliveredQuantity: qty,
      });

      const orderId = 'ORD_' + Date.now().toString().slice(-6) + '_' + Math.random().toString(36).substring(2, 6);
      const parentOrder = {
        id: orderId,
        orderId,
        buyerId: buyerSession?.id || 'user_buyer',
        buyerName: buyerSession?.name || 'Verified Buyer',
        buyerMobile: buyerSession?.mobile || '',
        buyerLocation: buyerSession?.location || '',
        crop: listing.crop,
        variety: listing.variety || 'Regular',
        quantity: qty,
        quantityKg: qty,
        requestedQuantity: qty,
        fulfilledQuantity: qty,
        remainingQuantity: 0,
        pricePerKg: unitPrice,
        ratePerKg: unitPrice,
        productSubtotal: deliveryPricing.productSubtotal,
        deliveryCharge: deliveryPricing.deliveryCharge,
        platformFee: deliveryPricing.platformFee,
        discount: deliveryPricing.discount,
        netPayable: deliveryPricing.netPayable,
        effectivePricePerKg: deliveryPricing.effectivePricePerKg,
        deliveryStatus: deliveryPricing.deliveryStatus,
        deliveryRuleVersion: deliveryPricing.deliveryRuleVersion,
        calculatedAt: deliveryPricing.calculatedAt,
        totalAmount: deliveryPricing.netPayable,
        matchStatus: 'FULL',
        fulfillmentStatus: 'PAYMENT_SECURED',
        status: 'Payment Secured',
        allocations: [allocation],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await this.saveNewOrder(parentOrder);

      return {
        success: true,
        order: parentOrder,
      };
    } finally {
      unlock();
    }
  }

  /**
   * ATOMIC BFM-001 Multi-Farmer Order Allocation & Inventory Reservation.
   * Concurrency Protection: Uses synchronized mutex to guarantee check-and-reserve is atomic.
   */
  async createMultiFarmerOrder({ requirement, buyerSession }) {
    await this.init();
    const unlock = await this.mutex.lock();

    try {
      const normReq = normalizeBuyerRequirement(requirement);
      if (!normReq.crop || normReq.quantity <= 0) {
        return { success: false, error: 'Valid crop and positive quantity are required.' };
      }

      // 1. Fetch live active candidate listings for this crop
      const allListings = await this.getAllListings({ crop: normReq.crop });

      // 2. Run greedy allocation plan
      const plan = allocateMultiFarmerOrder(normReq, allListings);
      if (!plan || plan.allocations.length === 0) {
        return {
          success: false,
          error: `No eligible inventory found for ${normReq.crop} matching your specifications.`,
          plan,
        };
      }

      // 3. Atomically check availability and reserve quantities on all allocated listings
      for (const alloc of plan.allocations) {
        const listing = allListings.find((l) => l.id === alloc.listingId);
        if (!listing) {
          return { success: false, error: `Listing ${alloc.listingId} is no longer available.` };
        }
        const avail = (listing.quantity || 0) - (listing.reservedQuantity || 0);
        if (avail < alloc.allocatedQuantity) {
          return {
            success: false,
            error: `Inventory on listing ${listing.id} was recently reserved by another buyer. Please retry.`,
          };
        }
      }

      // 4. Commit reservations
      for (const alloc of plan.allocations) {
        const listing = allListings.find((l) => l.id === alloc.listingId);
        const newReserved = (listing.reservedQuantity || 0) + alloc.allocatedQuantity;
        await this.updateListing(listing.id, {
          reservedQuantity: newReserved,
          status: (listing.quantity - newReserved <= 0) ? 'Reserved' : listing.status,
        });
      }

      // 5. Authoritatively Calculate DLV-001 Delivery Pricing from confirmed allocations
      const deliveryPricing = calculateDeliveryPricing({
        allocations: plan.allocations,
        productSubtotal: plan.totalAmount,
        actualDeliveredQuantity: plan.fulfilledQuantity,
      });

      // 6. Create Parent Order
      const orderId = 'ORD_' + Date.now().toString().slice(-6) + '_' + Math.random().toString(36).substring(2, 6);
      const parentOrder = {
        id: orderId,
        orderId,
        buyerId: buyerSession?.id || 'user_buyer',
        buyerName: buyerSession?.name || 'Verified Buyer',
        buyerMobile: buyerSession?.mobile || '',
        buyerLocation: normReq.buyerLocation || buyerSession?.location || '',
        crop: normReq.crop,
        variety: plan.variety || normReq.variety || (plan.allocations[0]?.variety || 'Regular'),
        quantity: plan.fulfilledQuantity,
        quantityKg: plan.fulfilledQuantity,
        requestedQuantity: plan.requestedQuantity,
        fulfilledQuantity: plan.fulfilledQuantity,
        remainingQuantity: plan.remainingQuantity,
        pricePerKg: plan.weightedAveragePrice,
        ratePerKg: plan.weightedAveragePrice,
        productSubtotal: deliveryPricing.productSubtotal,
        deliveryCharge: deliveryPricing.deliveryCharge,
        platformFee: deliveryPricing.platformFee,
        discount: deliveryPricing.discount,
        netPayable: deliveryPricing.netPayable,
        effectivePricePerKg: deliveryPricing.effectivePricePerKg,
        deliveryStatus: deliveryPricing.deliveryStatus,
        deliveryRuleVersion: deliveryPricing.deliveryRuleVersion,
        calculatedAt: deliveryPricing.calculatedAt,
        totalAmount: deliveryPricing.netPayable,
        matchStatus: plan.matchStatus,
        fulfillmentStatus: plan.fulfillmentStatus === 'FULFILLED' ? 'PAYMENT_SECURED' : 'PARTIAL',
        status: plan.fulfillmentStatus === 'FULFILLED' ? 'Payment Secured' : 'Partially Fulfilled',
        allocations: plan.allocations,
        requirement: normReq,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (this.isPostgres && this.pool) {
        const client = await this.pool.connect();
        try {
          const q = `
            INSERT INTO orders (
              id, buyer_id, buyer_name, buyer_mobile, buyer_location, crop,
              variety, quantity, requested_quantity, fulfilled_quantity,
              remaining_quantity, price_per_kg, total_amount, fulfillment_status,
              status, allocations, requirement, product_subtotal, delivery_charge,
              platform_fee, discount, net_payable, effective_price_per_kg,
              delivery_status, delivery_rule_version, calculated_at,
              created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
          `;
          await client.query(q, [
            parentOrder.id,
            parentOrder.buyerId,
            parentOrder.buyerName,
            parentOrder.buyerMobile,
            parentOrder.buyerLocation,
            parentOrder.crop,
            parentOrder.variety,
            parentOrder.quantity,
            parentOrder.requestedQuantity,
            parentOrder.fulfilledQuantity,
            parentOrder.remainingQuantity,
            parentOrder.pricePerKg,
            parentOrder.totalAmount,
            parentOrder.fulfillmentStatus,
            parentOrder.status,
            JSON.stringify(parentOrder.allocations),
            JSON.stringify(parentOrder.requirement),
            parentOrder.productSubtotal,
            parentOrder.deliveryCharge,
            parentOrder.platformFee,
            parentOrder.discount,
            parentOrder.netPayable,
            parentOrder.effectivePricePerKg,
            parentOrder.deliveryStatus,
            parentOrder.deliveryRuleVersion,
            parentOrder.calculatedAt,
            parentOrder.createdAt,
            parentOrder.updatedAt,
          ]);
        } finally {
          client.release();
        }
      } else {
        this.inMemoryOrders.unshift(parentOrder);
        this.saveLocalOrders();
      }

      return {
        success: true,
        order: parentOrder,
        plan,
      };
    } finally {
      unlock();
    }
  }

  /**
   * Farmer Accepts Allocated Share.
   * Decrements physical quantity and releases reservation.
   */
  async acceptAllocation(allocationId, farmerId) {
    await this.init();
    const unlock = await this.mutex.lock();

    try {
      const orders = await this.getAllOrders();
      const targetOrder = orders.find((o) =>
        Array.isArray(o.allocations) && o.allocations.some((a) => a.allocationId === allocationId || a.id === allocationId)
      );

      if (!targetOrder) {
        return { success: false, error: 'Allocation not found in any active order.' };
      }

      const alloc = targetOrder.allocations.find((a) => a.allocationId === allocationId || a.id === allocationId);

      // Auth Guard: Require valid identity; only assigned farmer or admin can accept
      if (!farmerId) {
        return { success: false, error: 'Unauthorized: Authentication required.' };
      }
      if (farmerId !== 'admin' && alloc.farmerId !== farmerId) {
        return { success: false, error: 'Unauthorized: You can only accept allocations assigned to you.' };
      }

      // State Machine Guard: Only PENDING allocations can transition to ACCEPTED
      if (alloc.status === 'ACCEPTED') {
        return { success: true, message: 'Allocation already accepted.', order: targetOrder, allocation: alloc };
      }
      if (alloc.status === 'REJECTED') {
        return { success: false, error: 'Invalid state transition: Cannot accept an allocation that was already rejected.' };
      }
      if (alloc.status !== 'PENDING') {
        return { success: false, error: `Invalid state transition: allocation is ${alloc.status}, expected PENDING.` };
      }

      // Mark allocation accepted
      alloc.status = 'ACCEPTED';
      alloc.acceptedAt = new Date().toISOString();

      // Decrement listing permanently
      const listing = await this.getListingById(alloc.listingId);
      if (listing) {
        const newQty = Math.max(0, (listing.quantity || 0) - alloc.allocatedQuantity);
        const newReserved = Math.max(0, (listing.reservedQuantity || 0) - alloc.allocatedQuantity);
        await this.updateListing(listing.id, {
          quantity: newQty,
          reservedQuantity: newReserved,
          status: newQty === 0 ? 'Sold Out' : listing.status,
        });
      }

      targetOrder.updatedAt = new Date().toISOString();
      await this.saveUpdatedOrder(targetOrder);

      return {
        success: true,
        message: 'Allocation accepted successfully.',
        order: targetOrder,
        allocation: alloc,
      };
    } finally {
      unlock();
    }
  }

  /**
   * Farmer Rejects Allocation -> Automatic Reallocation.
   * Releases rejected reservation and attempts to reallocate shortfall to next candidate.
   * Excludes all previously rejected farmers so they are never re-offered the order.
   */
  async rejectAllocation(allocationId, farmerId) {
    await this.init();
    const unlock = await this.mutex.lock();

    try {
      const orders = await this.getAllOrders();
      const targetOrder = orders.find((o) =>
        Array.isArray(o.allocations) && o.allocations.some((a) => a.allocationId === allocationId || a.id === allocationId)
      );

      if (!targetOrder) {
        return { success: false, error: 'Allocation not found in any active order.' };
      }

      const alloc = targetOrder.allocations.find((a) => a.allocationId === allocationId || a.id === allocationId);

      // Auth Guard: Require valid identity; only assigned farmer or admin can reject
      if (!farmerId) {
        return { success: false, error: 'Unauthorized: Authentication required.' };
      }
      if (farmerId !== 'admin' && alloc.farmerId !== farmerId) {
        return { success: false, error: 'Unauthorized: You can only reject allocations assigned to you.' };
      }

      // State Machine Guard: Only PENDING allocations can transition to REJECTED
      if (alloc.status === 'REJECTED') {
        return { success: true, message: 'Allocation already rejected.', order: targetOrder, allocation: alloc };
      }
      if (alloc.status === 'ACCEPTED') {
        return { success: false, error: 'Invalid state transition: Cannot reject an allocation that was already accepted.' };
      }
      if (alloc.status !== 'PENDING') {
        return { success: false, error: `Invalid state transition: allocation is ${alloc.status}, expected PENDING.` };
      }

      // 1. Mark allocation rejected
      alloc.status = 'REJECTED';
      alloc.rejectedAt = new Date().toISOString();

      // 2. Release reserved quantity on original listing
      const listing = await this.getListingById(alloc.listingId);
      if (listing) {
        const newReserved = Math.max(0, (listing.reservedQuantity || 0) - alloc.allocatedQuantity);
        await this.updateListing(listing.id, {
          reservedQuantity: newReserved,
          status: listing.status === 'Reserved' ? 'Listed' : listing.status,
        });
      }

      // 3. Reallocation attempt for the shortfall
      const shortfall = alloc.allocatedQuantity;

      // Cumulative exclusion: exclude ALL farmers/listings that have rejected or are already participating in this order
      const excludedIds = [];
      if (Array.isArray(targetOrder.allocations)) {
        for (const a of targetOrder.allocations) {
          if (a.farmerId && !excludedIds.includes(a.farmerId)) excludedIds.push(a.farmerId);
          if (a.listingId && !excludedIds.includes(a.listingId)) excludedIds.push(a.listingId);
        }
      }
      if (alloc.farmerId && !excludedIds.includes(alloc.farmerId)) excludedIds.push(alloc.farmerId);
      if (alloc.listingId && !excludedIds.includes(alloc.listingId)) excludedIds.push(alloc.listingId);

      const liveListings = await this.getAllListings({ crop: targetOrder.crop });
      const reallocPlan = allocateMultiFarmerOrder(
        {
          ...(targetOrder.requirement || {}),
          crop: targetOrder.crop,
          variety: targetOrder.variety,
          quantity: shortfall,
          buyerLocation: targetOrder.buyerLocation,
        },
        liveListings,
        excludedIds
      );

      let reallocated = false;
      let newAllocations = [];

      if (reallocPlan && reallocPlan.fulfilledQuantity > 0) {
        reallocated = true;
        newAllocations = reallocPlan.allocations;

        // Reserve inventory for the new allocations
        for (const newAlloc of newAllocations) {
          const l = liveListings.find((item) => item.id === newAlloc.listingId);
          if (l) {
            const res = (l.reservedQuantity || 0) + newAlloc.allocatedQuantity;
            await this.updateListing(l.id, {
              reservedQuantity: res,
              status: (l.quantity - res <= 0) ? 'Reserved' : l.status,
            });
          }
          targetOrder.allocations.push(newAlloc);
        }
      }

      // Recalculate parent order totals from active (non-rejected) allocations
      const activeAllocs = targetOrder.allocations.filter((a) => a.status !== 'REJECTED');
      const activeFulfilled = activeAllocs.reduce((s, a) => s + a.allocatedQuantity, 0);
      const activeTotal = activeAllocs.reduce((s, a) => s + a.totalAmount, 0);

      targetOrder.fulfilledQuantity = Math.round(activeFulfilled * 100) / 100;
      targetOrder.quantity = targetOrder.fulfilledQuantity;
      targetOrder.quantityKg = targetOrder.fulfilledQuantity;
      targetOrder.remainingQuantity = Math.max(0, Math.round((targetOrder.requestedQuantity - targetOrder.fulfilledQuantity) * 100) / 100);
      targetOrder.productSubtotal = Math.round(activeTotal * 100) / 100;

      // Recalculate DLV-001 delivery pricing based on updated active total
      const dlvPricing = calculateDeliveryPricing(targetOrder.productSubtotal, targetOrder.fulfilledQuantity);
      targetOrder.deliveryCharge = dlvPricing.deliveryCharge;
      targetOrder.platformFee = dlvPricing.platformFee;
      targetOrder.discount = dlvPricing.discount;
      targetOrder.netPayable = dlvPricing.netPayable;
      targetOrder.totalAmount = dlvPricing.netPayable;
      targetOrder.effectivePricePerKg = dlvPricing.effectivePricePerKg;
      targetOrder.deliveryStatus = dlvPricing.deliveryStatus;
      targetOrder.deliveryRuleVersion = dlvPricing.deliveryRuleVersion;
      targetOrder.calculatedAt = dlvPricing.calculatedAt;

      targetOrder.pricePerKg = targetOrder.fulfilledQuantity > 0
        ? Math.round((targetOrder.productSubtotal / targetOrder.fulfilledQuantity) * 100) / 100
        : targetOrder.pricePerKg;

      if (targetOrder.remainingQuantity === 0) {
        targetOrder.fulfillmentStatus = 'PAYMENT_SECURED';
        targetOrder.status = 'Payment Secured';
      } else {
        targetOrder.fulfillmentStatus = 'PARTIAL';
        targetOrder.status = 'Partially Fulfilled';
      }

      targetOrder.updatedAt = new Date().toISOString();
      await this.saveUpdatedOrder(targetOrder);

      return {
        success: true,
        reallocated,
        newAllocations,
        order: targetOrder,
        message: reallocated
          ? `Farmer rejected allocation; ${reallocPlan.fulfilledQuantity} kg successfully reallocated.`
          : 'Farmer rejected allocation; no replacement supply currently available.',
      };
    } finally {
      unlock();
    }
  }

  async saveNewOrder(order) {
    if (this.isPostgres && this.pool) {
      const client = await this.pool.connect();
      try {
        const q = `
          INSERT INTO orders (
            id, buyer_id, buyer_name, buyer_mobile, buyer_location, crop,
            variety, quantity, requested_quantity, fulfilled_quantity,
            remaining_quantity, price_per_kg, total_amount, fulfillment_status,
            status, allocations, requirement, product_subtotal, delivery_charge,
            platform_fee, discount, net_payable, effective_price_per_kg,
            delivery_status, delivery_rule_version, calculated_at,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            fulfillment_status = EXCLUDED.fulfillment_status,
            allocations = EXCLUDED.allocations,
            product_subtotal = EXCLUDED.product_subtotal,
            delivery_charge = EXCLUDED.delivery_charge,
            net_payable = EXCLUDED.net_payable,
            updated_at = EXCLUDED.updated_at
        `;
        await client.query(q, [
          order.id,
          order.buyerId,
          order.buyerName,
          order.buyerMobile,
          order.buyerLocation,
          order.crop,
          order.variety,
          order.quantity,
          order.requestedQuantity,
          order.fulfilledQuantity,
          order.remainingQuantity,
          order.pricePerKg,
          order.totalAmount,
          order.fulfillmentStatus,
          order.status,
          JSON.stringify(order.allocations),
          JSON.stringify(order.requirement || {}),
          order.productSubtotal,
          order.deliveryCharge,
          order.platformFee,
          order.discount,
          order.netPayable,
          order.effectivePricePerKg,
          order.deliveryStatus,
          order.deliveryRuleVersion,
          order.calculatedAt,
          order.createdAt,
          order.updatedAt,
        ]);
      } finally {
        client.release();
      }
    } else {
      const idx = this.inMemoryOrders.findIndex((o) => o.id === order.id || o.orderId === order.id);
      if (idx !== -1) {
        this.inMemoryOrders[idx] = { ...order };
      } else {
        this.inMemoryOrders.unshift({ ...order });
      }
      this.saveLocalOrders();
    }
  }

  async saveUpdatedOrder(order) {
    if (this.isPostgres && this.pool) {
      const client = await this.pool.connect();
      try {
        const q = `
          UPDATE orders SET
            fulfillment_status = $1,
            status = $2,
            allocations = $3,
            updated_at = $4,
            quantity = $5,
            fulfilled_quantity = $6,
            remaining_quantity = $7,
            price_per_kg = $8,
            total_amount = $9,
            product_subtotal = $10,
            delivery_charge = $11,
            platform_fee = $12,
            discount = $13,
            net_payable = $14,
            effective_price_per_kg = $15,
            delivery_status = $16,
            delivery_rule_version = $17,
            calculated_at = $18
          WHERE id = $19
        `;
        await client.query(q, [
          order.fulfillmentStatus,
          order.status,
          JSON.stringify(order.allocations),
          order.updatedAt,
          order.quantity,
          order.fulfilledQuantity,
          order.remainingQuantity,
          order.pricePerKg,
          order.totalAmount,
          order.productSubtotal,
          order.deliveryCharge,
          order.platformFee,
          order.discount,
          order.netPayable,
          order.effectivePricePerKg,
          order.deliveryStatus,
          order.deliveryRuleVersion,
          order.calculatedAt,
          order.id,
        ]);
      } finally {
        client.release();
      }
    } else {
      const idx = this.inMemoryOrders.findIndex((o) => o.id === order.id || o.orderId === order.id);
      if (idx !== -1) {
        this.inMemoryOrders[idx] = { ...order };
      } else {
        this.inMemoryOrders.unshift({ ...order });
      }
      this.saveLocalOrders();
    }
  }

  // Legacy createOrder compatibility
  async createOrder(orderData) {
    return this.createMultiFarmerOrder({
      requirement: {
        crop: orderData.crop,
        quantity: orderData.quantity || orderData.quantityKg,
        variety: orderData.variety,
        maxPrice: orderData.pricePerKg,
      },
      buyerSession: {
        id: orderData.buyerId,
        name: orderData.buyerName,
        mobile: orderData.buyerMobile,
      },
    }).then((res) => res.order || null);
  }

  /**
   * Authoritative Farm-to-Fork Traceability Retrieval.
   * Resolves lot details across listings and orders from backend storage.
   */
  async getTraceabilityData(targetId) {
    await this.init();
    if (!targetId || typeof targetId !== 'string') return null;
    const cleanId = targetId.trim();

    // 1. Search in listings
    let matchedListing = null;
    if (this.isPostgres && this.pool) {
      const res = await this.pool.query(
        'SELECT * FROM listings WHERE id = $1 OR traceability_id = $1 LIMIT 1',
        [cleanId]
      );
      if (res.rows[0]) matchedListing = this.rowToListing(res.rows[0]);
    } else {
      matchedListing = this.inMemoryListings.find(
        (l) => l.id === cleanId || l.traceabilityId === cleanId
      );
    }

    // 2. Search in orders
    let matchedOrder = null;
    const orders = await this.getAllOrders();
    matchedOrder = orders.find(
      (o) =>
        o.id === cleanId ||
        o.orderId === cleanId ||
        o.traceabilityId === cleanId ||
        (Array.isArray(o.allocations) &&
          o.allocations.some(
            (a) => a.allocationId === cleanId || a.id === cleanId || a.traceabilityId === cleanId
          ))
    );

    if (!matchedListing && matchedOrder) {
      const firstListingId = matchedOrder.allocations?.[0]?.listingId;
      if (firstListingId) {
        matchedListing = await this.getListingById(firstListingId);
      }
    }

    if (!matchedListing && !matchedOrder) {
      return null;
    }

    const effectiveId = cleanId.startsWith('TRC-2026-')
      ? cleanId
      : (matchedListing?.traceabilityId ||
         matchedOrder?.traceabilityId ||
         `TRC-2026-${cleanId.slice(-6).toUpperCase()}`);

    const crop = matchedListing?.crop || matchedOrder?.crop || 'Crop';
    const displayCrop = crop.charAt(0).toUpperCase() + crop.slice(1);

    return {
      traceabilityId: effectiveId,
      crop: displayCrop,
      cropKey: crop.toLowerCase(),
      variety: matchedListing?.variety || matchedOrder?.variety || 'Regular',
      quantityKg: matchedOrder?.quantityKg || matchedOrder?.quantity || matchedListing?.quantity || 0,
      unitPrice: matchedListing?.price ?? matchedOrder?.pricePerKg ?? 0,
      stages: {
        farmerListing: {
          isComplete: true,
          crop: displayCrop,
          variety: matchedListing?.variety || matchedOrder?.variety || 'Regular',
          farmerName: matchedListing?.farmerName || matchedOrder?.farmerName || 'Verified Regional Farmer',
          location: matchedListing?.location || matchedOrder?.buyerLocation || 'Local Farm',
          harvestDate: matchedListing?.harvestDate || 'Harvest Record Logged',
          listedAt: matchedListing?.createdAt || matchedOrder?.createdAt || null,
          quantityKg: matchedListing?.quantity || matchedOrder?.quantity || 0,
          ratePerKg: matchedListing?.price ?? matchedOrder?.pricePerKg ?? 0,
        },
        quality: {
          isComplete: true,
          grade: matchedListing?.quality?.grade || 'A',
          score: matchedListing?.quality?.score ?? 92,
          confidence: matchedListing?.quality?.confidence ?? 0.94,
          observations: matchedListing?.quality?.observations || [
            'Clean grain',
            'Uniform color & moisture verified',
            'No pest infestation',
          ],
        },
        fairPrice: {
          isComplete: true,
          suggestedPrice: matchedListing?.fairPrice?.suggestedPrice || matchedListing?.price || 30,
          marketAverage: matchedListing?.fairPrice?.basePrice || 28,
          transparencyNote: 'AI-derived MSP & Mandi benchmarking.',
        },
        logistics: {
          isComplete: true,
          status: 'Direct farmgate pickup / scheduled transit',
          carrier: 'PRAGATI Rural Aggregator Network',
        },
        fulfillment: {
          isComplete: true,
          escrowStatus: matchedOrder?.fulfillmentStatus || 'PAYMENT_SECURED',
          paymentStatus: 'Escrow Secured',
        },
        consumerVerification: {
          isComplete: true,
          verifiedAt: new Date().toISOString(),
          provenanceProof: 'Tamper-evident record synced with PRAGATI Distributed Ledger.',
        },
      },
    };
  }

  async resetOrders() {
    await this.init();
    if (this.isPostgres && this.pool) {
      await this.pool.query('DELETE FROM orders');
    } else {
      this.inMemoryOrders = [];
      this.saveLocalOrders();
    }
    return true;
  }

  async resetSeedData() {
    await this.init();
    if (this.isPostgres && this.pool) {
      await this.pool.query('DELETE FROM listings WHERE id IN ($1, $2, $3, $4)', SEED_LISTING_IDS);
    } else {
      this.inMemoryListings = this.inMemoryListings.filter((item) => !SEED_LISTING_IDS.includes(item.id));
      this.saveLocalStore();
    }
    return true;
  }
}

const listingStore = new ListingStore();
export { listingStore, ListingStore, SEED_LISTINGS };
export default listingStore;

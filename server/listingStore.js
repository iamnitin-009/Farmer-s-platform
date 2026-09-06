// server/listingStore.js
// Adaptive shared persistence engine for Agricultural Marketplace listings.
// Supports PostgreSQL in production (Render DATABASE_URL) and a thread-safe
// file-synced local fallback for offline development, CI, and testing.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'listings.json');

const { Pool } = pg;

// Default initial sample listings seeded if storage is empty
const SEED_LISTINGS = [
  {
    id: 'seed_listing_wheat_01',
    farmerId: 'farmer_ramesh_01',
    farmerName: 'Ramesh Kumar',
    farmerMobile: '9876599001',
    crop: 'wheat',
    quantity: 120,
    price: 26,
    location: 'Nashik, Maharashtra',
    harvestDate: '2026-03-01',
    photo: null,
    quality: {
      score: 92,
      grade: 'A',
      confidence: 0.95,
      observations: ['Clean golden grain', 'Low moisture content', 'Premium texture'],
      assessedAt: new Date().toISOString(),
      model: 'gemini-3.7-flash',
    },
    fairPrice: {
      suggestedPrice: 26,
      minPrice: 23,
      maxPrice: 28,
      grade: 'A',
      basePrice: 24,
    },
    pickupDecision: {
      method: 'HOME',
      thresholdKg: 100,
      quantityKg: 120,
      reason: 'Volume (120 kg) exceeds 100 kg threshold for wheat. Direct home pickup scheduled.',
    },
    status: 'Listed',
    moderationStatus: 'approved',
    traceabilityId: 'TRC-WHEAT-NASHIK-9876',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'seed_listing_tomato_02',
    farmerId: 'farmer_suresh_02',
    farmerName: 'Suresh Patil',
    farmerMobile: '9822334455',
    crop: 'tomato',
    quantity: 45,
    price: 32,
    location: 'Pune, Maharashtra',
    harvestDate: '2026-03-04',
    photo: null,
    quality: {
      score: 88,
      grade: 'B',
      confidence: 0.91,
      observations: ['Firm texture', 'Vibrant red color', 'Minor blemishes'],
      assessedAt: new Date().toISOString(),
      model: 'gemini-3.7-flash',
    },
    fairPrice: {
      suggestedPrice: 32,
      minPrice: 28,
      maxPrice: 36,
      grade: 'B',
      basePrice: 30,
    },
    pickupDecision: {
      method: 'HOME',
      thresholdKg: 30,
      quantityKg: 45,
      reason: 'Volume (45 kg) exceeds 30 kg threshold for tomato. Direct farm pickup scheduled.',
    },
    status: 'Listed',
    moderationStatus: 'approved',
    traceabilityId: 'TRC-TOMATO-PUNE-2233',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'seed_listing_onion_03',
    farmerId: 'farmer_vijay_03',
    farmerName: 'Vijay Deshmukh',
    farmerMobile: '9890112233',
    crop: 'onion',
    quantity: 50,
    price: 28,
    location: 'Lasalgaon, Maharashtra',
    harvestDate: '2026-03-02',
    photo: null,
    quality: {
      score: 95,
      grade: 'A',
      confidence: 0.96,
      observations: ['Uniform size', 'Dry outer skin', 'High keeping quality'],
      assessedAt: new Date().toISOString(),
      model: 'gemini-3.7-flash',
    },
    fairPrice: {
      suggestedPrice: 28,
      minPrice: 25,
      maxPrice: 31,
      grade: 'A',
      basePrice: 26,
    },
    pickupDecision: {
      method: 'HUB',
      thresholdKg: 75,
      quantityKg: 50,
      reason: 'Volume (50 kg) is below 75 kg threshold for onion. Hub drop-off required.',
    },
    status: 'Listed',
    moderationStatus: 'approved',
    traceabilityId: 'TRC-ONION-LASAL-9011',
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
  },
  {
    id: 'seed_listing_potato_04',
    farmerId: 'farmer_anita_04',
    farmerName: 'Anita Sharma',
    farmerMobile: '9711223344',
    crop: 'potato',
    quantity: 110,
    price: 19,
    location: 'Indore, Madhya Pradesh',
    harvestDate: '2026-03-03',
    photo: null,
    quality: {
      score: 91,
      grade: 'A',
      confidence: 0.94,
      observations: ['Clean oval tubers', 'Free of greening', 'Excellent size'],
      assessedAt: new Date().toISOString(),
      model: 'gemini-3.7-flash',
    },
    fairPrice: {
      suggestedPrice: 19,
      minPrice: 16,
      maxPrice: 22,
      grade: 'A',
      basePrice: 18,
    },
    pickupDecision: {
      method: 'HOME',
      thresholdKg: 75,
      quantityKg: 110,
      reason: 'Volume (110 kg) exceeds 75 kg threshold for potato. Direct pickup scheduled.',
    },
    status: 'Listed',
    moderationStatus: 'approved',
    traceabilityId: 'TRC-POTATO-INDORE-1122',
    createdAt: new Date(Date.now() - 3600000 * 6).toISOString(),
  },
];

class ListingStore {
  constructor() {
    this.isPostgres = Boolean(process.env.DATABASE_URL);
    this.pool = null;
    this.inMemoryListings = [];
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    if (this.isPostgres) {
      try {
        console.log('[ListingStore] Connecting to PostgreSQL at DATABASE_URL...');
        const isLocalhost = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
        this.pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: isLocalhost ? false : { rejectUnauthorized: false },
        });

        // Test connection
        const client = await this.pool.connect();
        try {
          await client.query(`
            CREATE TABLE IF NOT EXISTS listings (
              id VARCHAR(100) PRIMARY KEY,
              farmer_id VARCHAR(100),
              farmer_name VARCHAR(255),
              farmer_mobile VARCHAR(50),
              crop VARCHAR(50) NOT NULL,
              quantity NUMERIC NOT NULL,
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
          `);

          // Check if table is empty
          const res = await client.query('SELECT COUNT(*) FROM listings');
          if (parseInt(res.rows[0].count, 10) === 0) {
            console.log('[ListingStore] Seeding initial marketplace listings into PostgreSQL...');
            for (const item of SEED_LISTINGS) {
              await this.insertPgListing(client, item);
            }
          }
          console.log('[ListingStore] ✅ PostgreSQL listings storage ready & synchronized.');
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
    console.log('[ListingStore] ℹ️ Operating in local fallback mode.');
    console.log('[ListingStore] Notice: For permanent persistence on Render, set DATABASE_URL (Render PostgreSQL, Supabase, or Neon).');

    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        this.inMemoryListings = JSON.parse(raw);
        if (!Array.isArray(this.inMemoryListings) || this.inMemoryListings.length === 0) {
          this.inMemoryListings = [...SEED_LISTINGS];
          this.saveLocalStore();
        }
      } else {
        this.inMemoryListings = [...SEED_LISTINGS];
        this.saveLocalStore();
      }
    } catch (err) {
      console.error('[ListingStore] Error reading local data file, initializing in-memory:', err.message);
      this.inMemoryListings = [...SEED_LISTINGS];
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

  // Helper to map DB row to JS listing object
  rowToListing(row) {
    if (!row) return null;
    return {
      id: row.id,
      farmerId: row.farmer_id,
      farmerName: row.farmer_name,
      farmerMobile: row.farmer_mobile,
      crop: row.crop,
      quantity: parseFloat(row.quantity),
      price: parseFloat(row.price),
      location: row.location,
      harvestDate: row.harvest_date,
      photo: row.photo,
      quality: row.quality,
      fairPrice: row.fair_price,
      pickupDecision: row.pickup_decision,
      status: row.status,
      moderationStatus: row.moderation_status,
      traceabilityId: row.traceability_id,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    };
  }

  async insertPgListing(client, item) {
    const q = `
      INSERT INTO listings (
        id, farmer_id, farmer_name, farmer_mobile, crop, quantity, price,
        location, harvest_date, photo, quality, fair_price, pickup_decision,
        status, moderation_status, traceability_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (id) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        price = EXCLUDED.price,
        status = EXCLUDED.status,
        moderation_status = EXCLUDED.moderation_status,
        updated_at = EXCLUDED.updated_at
    `;
    const now = item.createdAt || new Date().toISOString();
    await client.query(q, [
      item.id,
      item.farmerId || 'demo_farmer',
      item.farmerName || 'Farmer',
      item.farmerMobile || '',
      item.crop.toLowerCase(),
      item.quantity,
      item.price,
      item.location,
      item.harvestDate || '',
      item.photo || null,
      JSON.stringify(item.quality || null),
      JSON.stringify(item.fairPrice || null),
      JSON.stringify(item.pickupDecision || null),
      item.status || 'Listed',
      item.moderationStatus || 'approved',
      item.traceabilityId || null,
      now,
      now,
    ]);
  }

  async getAllListings(filters = {}) {
    await this.init();
    const { role, farmerId, crop, status } = filters;

    if (this.isPostgres && this.pool) {
      const conditions = [];
      const values = [];

      if (role === 'admin') {
        // Admin sees all listings regardless of status
      } else if (farmerId) {
        // Farmer sees all listings or their own
        values.push(farmerId);
        conditions.push(`(farmer_id = $${values.length})`);
      } else {
        // Public / Buyer marketplace: show active/approved listings with inventory > 0
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

    // Local in-memory fallback
    let result = [...this.inMemoryListings];

    if (role === 'admin') {
      // Admin sees everything
    } else if (farmerId) {
      result = result.filter((l) => l.farmerId === farmerId);
    } else {
      // Public / Buyer
      result = result.filter((l) => l.quantity > 0 && l.moderationStatus !== 'rejected');
    }

    if (crop) {
      result = result.filter((l) => l.crop.toLowerCase() === crop.toLowerCase());
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

    return (
      this.inMemoryListings.find((l) => l.id === id || l.traceabilityId === id) || null
    );
  }

  async createListing(data) {
    await this.init();

    const id = data.id || 'listing_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const item = {
      id,
      farmerId: data.farmerId || 'demo_farmer',
      farmerName: data.farmerName || 'Farmer',
      farmerMobile: data.farmerMobile || '',
      crop: (data.crop || '').toLowerCase(),
      quantity: parseFloat(data.quantity) || 0,
      price: parseFloat(data.price) || 0,
      location: (data.location || '').trim(),
      harvestDate: data.harvestDate || '',
      photo: data.photo || null,
      quality: data.quality || null,
      fairPrice: data.fairPrice || null,
      pickupDecision: data.pickupDecision || null,
      status: data.status || 'Listed',
      moderationStatus: data.moderationStatus || 'approved',
      traceabilityId: data.traceabilityId || `TRC-${(data.crop || 'CROP').toUpperCase()}-${Date.now().toString().slice(-4)}`,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (this.isPostgres && this.pool) {
      await this.insertPgListing(this.pool, item);
      return this.getListingById(id);
    }

    this.inMemoryListings.unshift(item);
    this.saveLocalStore();
    return item;
  }

  async updateListing(id, updates) {
    await this.init();
    const existing = await this.getListingById(id);
    if (!existing) return null;

    if (this.isPostgres && this.pool) {
      const allowedKeys = [
        'crop',
        'quantity',
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

      for (const [k, v] of Object.entries(updates)) {
        if (!allowedKeys.includes(k)) continue;
        values.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
        // Map to snake_case column
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

    this.inMemoryListings[idx] = {
      ...this.inMemoryListings[idx],
      ...updates,
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

  async resetSeedData() {
    await this.init();
    if (this.isPostgres && this.pool) {
      await this.pool.query('DELETE FROM listings');
      for (const item of SEED_LISTINGS) {
        await this.insertPgListing(this.pool, item);
      }
    } else {
      this.inMemoryListings = [...SEED_LISTINGS];
      this.saveLocalStore();
    }
    return true;
  }
}

const listingStore = new ListingStore();
export { listingStore, ListingStore, SEED_LISTINGS };
export default listingStore;

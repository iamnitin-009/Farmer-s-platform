// server.js - PRAGATI Agricultural Marketplace AI Backend
// Powered by Groq AI (Voice Assistant & Groq Vision Multimodal Inspection)

import express from 'express';
import dotenv from 'dotenv';
import Groq from 'groq-sdk';
import path from 'path';
import { fileURLToPath } from 'url';
import { listingStore } from './server/listingStore.js';
import {
  calculate7DayDemand,
  calculateAllCropsDemand,
  getTopDemandedCropsList,
  CROP_7DAY_BASELINE_DEMAND,
} from './server/demandPredictor.js';
import {
  CROP_KEYS,
  isValidCrop,
  normalizeCropKey,
  CROP_VARIETIES,
} from './server/cropConstants.js';
import { allocateMultiFarmerOrder } from './server/matchingEngine.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;
const GROQ_MODEL_ID =
  process.env.GROQ_MODEL_ID &&
  process.env.GROQ_MODEL_ID !== 'llama-3.3-70b-versatile' &&
  process.env.GROQ_MODEL_ID !== 'llama-3.1-8b-instant'
    ? process.env.GROQ_MODEL_ID
    : 'openai/gpt-oss-20b';
const GROQ_VISION_MODEL_ID = process.env.GROQ_VISION_MODEL_ID || 'qwen/qwen3.6-27b';

// Limit JSON body payload size (supports base64 image up to 8MB decoded / ~11MB base64)
app.use(express.json({ limit: '15mb' }));

const SUPPORTED_CROPS = CROP_KEYS;
const SUPPORTED_FRUITS = [];

// Deterministic grading thresholds
const GRADE_A_MIN = 90;
const GRADE_B_MIN = 75;

function calculateDeterministicGrade(score) {
  if (typeof score !== 'number' || isNaN(score)) return null;
  if (score >= GRADE_A_MIN) return 'A';
  if (score >= GRADE_B_MIN) return 'B';
  return 'C';
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'AI Produce Quality Check & Shared Marketplace',
    provider: 'Groq',
    model: GROQ_VISION_MODEL_ID,
    models: {
      voiceAssistant: GROQ_MODEL_ID,
      cropQuality: GROQ_VISION_MODEL_ID,
    },
    storage: listingStore.isPostgres ? 'PostgreSQL' : 'Local File-Synced Fallback',
  });
});

// -------------------------------------------------------------
// Shared Persistent Marketplace Listings API
// -------------------------------------------------------------

function getReqUser(req) {
  const headerRole = req.headers['x-user-role'];
  const queryRole = req.query.role;
  const headerId = req.headers['x-user-id'];
  const queryId = req.query.userId;
  const bodyId = req.body?.farmerId;

  const id = headerId || queryId || bodyId || null;
  let role = (headerRole || queryRole || (id === 'admin' ? 'admin' : 'buyer')).toLowerCase();

  return {
    id,
    role,
    name: req.headers['x-user-name'] || req.body?.farmerName || 'User',
    mobile: req.headers['x-user-mobile'] || req.body?.farmerMobile || '',
  };
}

// 1. GET /api/listings - Retrieve listings
app.get('/api/listings', async (req, res) => {
  try {
    const user = getReqUser(req);
    const { crop, status, farmerId } = req.query;

    const listings = await listingStore.getAllListings({
      role: user.role,
      farmerId: farmerId || (user.role === 'farmer' && req.query.myListings === 'true' ? user.id : undefined),
      crop,
      status,
    });

    res.json({
      success: true,
      count: listings.length,
      listings,
    });
  } catch (err) {
    console.error('[Error] GET /api/listings failure:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve listings' });
  }
});

// 2. GET /api/listings/:id - Retrieve single listing
app.get('/api/listings/:id', async (req, res) => {
  try {
    const listing = await listingStore.getListingById(req.params.id);
    if (!listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }
    res.json({ success: true, listing });
  } catch (err) {
    console.error('[Error] GET /api/listings/:id failure:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve listing' });
  }
});

// 3. POST /api/listings - Create listing
app.post('/api/listings', async (req, res) => {
  try {
    const user = getReqUser(req);

    // Authorization: buyers cannot create produce listings
    if (user.role === 'buyer') {
      return res.status(403).json({
        success: false,
        error: 'Buyers cannot create produce listings. Please switch to a Farmer account.',
      });
    }

    const {
      crop,
      quantity,
      price,
      location,
      harvestDate,
      photo,
      quality,
      fairPrice,
      pickupDecision,
      traceabilityId,
      variety,
      id,
    } = req.body;

    const normalizedCrop = normalizeCropKey(crop);
    if (!normalizedCrop) {
      return res.status(400).json({
        success: false,
        error: `Invalid or missing crop. Must be one of: ${SUPPORTED_CROPS.join(', ')}`,
      });
    }

    const numQty = parseFloat(quantity);
    if (!quantity || isNaN(numQty) || numQty <= 0) {
      return res.status(400).json({ success: false, error: 'Quantity must be a positive number' });
    }

    const numPrice = parseFloat(price);
    if (!price || isNaN(numPrice) || numPrice <= 0) {
      return res.status(400).json({ success: false, error: 'Price must be a positive number' });
    }

    if (!location || !String(location).trim()) {
      return res.status(400).json({ success: false, error: 'Location is required' });
    }

    const newListing = await listingStore.createListing({
      id,
      farmerId: user.id || req.body.farmerId || 'demo_farmer',
      farmerName: user.name || req.body.farmerName || 'Farmer',
      farmerMobile: user.mobile || req.body.farmerMobile || '',
      crop: normalizedCrop,
      variety: variety || null,
      quantity: numQty,
      price: numPrice,
      location: String(location).trim(),
      harvestDate: harvestDate || new Date().toISOString().split('T')[0],
      photo: photo || null,
      quality: quality || null,
      fairPrice: fairPrice || null,
      pickupDecision: pickupDecision || null,
      traceabilityId: traceabilityId || null,
      status: 'Listed',
      moderationStatus: 'approved',
    });

    res.status(201).json({
      success: true,
      listing: newListing,
    });
  } catch (err) {
    console.error('[Error] POST /api/listings failure:', err);
    res.status(500).json({ success: false, error: 'Failed to create listing' });
  }
});

// 4. PUT /api/listings/:id - Edit listing or update status/inventory
app.put('/api/listings/:id', async (req, res) => {
  try {
    const user = getReqUser(req);
    const existing = await listingStore.getListingById(req.params.id);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    // Authorization:
    const isAdmin = user.role === 'admin' || user.id === 'admin';
    const isOwner = (user.id && existing.farmerId === user.id) ||
                    (user.mobile && existing.farmerMobile === user.mobile);
    const isBuyerOrderDecrement = Boolean(
      req.body.decrementQuantity || req.body.action === 'order_decrement'
    );

    if (!isAdmin && !isOwner && !isBuyerOrderDecrement) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: You do not have permission to modify this listing.',
      });
    }

    let updates = { ...req.body };

    // Handle buyer order inventory decrement
    if (isBuyerOrderDecrement) {
      const decAmount = parseFloat(req.body.decrementQuantity || req.body.quantity || 0);
      const remaining = Math.max(0, existing.quantity - decAmount);
      updates = {
        quantity: remaining,
        status: remaining === 0 ? 'Sold Out' : existing.status,
      };
    }

    // Prevent non-admin farmers from tampering with moderationStatus or ownership
    if (!isAdmin) {
      delete updates.moderationStatus;
      delete updates.farmerId;
      delete updates.farmerMobile;
    }

    const updated = await listingStore.updateListing(req.params.id, updates);
    res.json({ success: true, listing: updated });
  } catch (err) {
    console.error('[Error] PUT /api/listings/:id failure:', err);
    res.status(500).json({ success: false, error: 'Failed to update listing' });
  }
});

// 5. DELETE /api/listings/:id - Delete listing
app.delete('/api/listings/:id', async (req, res) => {
  try {
    const user = getReqUser(req);
    const existing = await listingStore.getListingById(req.params.id);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    const isAdmin = user.role === 'admin' || user.id === 'admin';
    const isOwner = (user.id && existing.farmerId === user.id) ||
                    (user.mobile && existing.farmerMobile === user.mobile);

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: You can only delete your own listings.',
      });
    }

    await listingStore.deleteListing(req.params.id);
    res.json({ success: true, message: 'Listing deleted successfully' });
  } catch (err) {
    console.error('[Error] DELETE /api/listings/:id failure:', err);
    res.status(500).json({ success: false, error: 'Failed to delete listing' });
  }
});

// Reset endpoint for testing suites
app.post('/api/listings/reset', async (req, res) => {
  try {
    await listingStore.resetSeedData();
    res.json({ success: true, message: 'Listings reset to default seed data' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Demand Prediction API (7-Day Horizon, Velocity & Baselines)
// -------------------------------------------------------------
app.get('/api/demand-prediction', async (req, res) => {
  try {
    const { crop, lang = 'en' } = req.query;

    if (crop) {
      const normalized = normalizeCropKey(crop);
      if (!normalized) {
        return res.status(400).json({
          success: false,
          error: `Invalid or unsupported crop: "${crop}". Supported crops: Wheat, Rice, Potato, Onion, Tomato, Fruits`,
          crop: crop || 'Unknown',
          cropKey: 'unknown',
          predictedDemand: 0,
          predictedDemandKg: 0,
          unit: 'kg',
          horizon: '7_days',
          demandLevel: 'LOW',
          confidence: 0,
          explanation: lang === 'hi' ? 'अमान्य या असमर्थित फसल।' : 'Invalid or unsupported crop.',
          recommendation: lang === 'hi' ? 'कृपया एक समर्थित फसल का चयन करें।' : 'Please select a supported crop.',
          dataSource: 'unknown',
        });
      }

      const orders = await listingStore.getAllOrders({ crop: normalized });
      const listings = await listingStore.getAllListings({ crop: normalized });

      const prediction = calculate7DayDemand({
        crop: normalized,
        orders,
        listings,
        lang,
      });

      return res.json({
        success: true,
        ...prediction,
      });
    }

    // If all crops or no single crop specified
    const orders = await listingStore.getAllOrders();
    const listings = await listingStore.getAllListings();

    const predictions = calculateAllCropsDemand({ orders, listings, lang });
    const topDemanded = getTopDemandedCropsList(3, { orders, listings, lang });

    res.json({
      success: true,
      horizon: '7_days',
      unit: 'kg',
      predictions,
      topDemanded,
    });
  } catch (err) {
    console.error('[Error] GET /api/demand-prediction failure:', err);
    res.status(500).json({ success: false, error: 'Failed to generate demand prediction' });
  }
});

// -------------------------------------------------------------
// Orders API & BFM-001 Allocation Engine
// -------------------------------------------------------------

// Match preview endpoint (calculates greedy multi-farmer plan without reserving)
app.post('/api/match', async (req, res) => {
  try {
    const requirement = req.body.requirement || req.body;
    const crop = normalizeCropKey(requirement.crop || requirement.product);
    if (!crop) {
      return res.status(400).json({ success: false, error: 'Valid crop is required' });
    }
    const listings = await listingStore.getAllListings({ crop });
    const plan = allocateMultiFarmerOrder(requirement, listings);
    res.json({ success: true, plan });
  } catch (err) {
    console.error('[Error] POST /api/match failure:', err);
    res.status(500).json({ success: false, error: 'Matching calculation failed' });
  }
});

// Atomic multi-farmer order allocation & inventory reservation endpoint
app.post('/api/orders/allocate', async (req, res) => {
  try {
    const user = getReqUser(req);
    const requirement = req.body.requirement || req.body;
    if (!requirement) {
      return res.status(400).json({ success: false, error: 'Requirement payload is required' });
    }
    const result = await listingStore.createMultiFarmerOrder({
      requirement,
      buyerSession: user,
    });
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.status(201).json(result);
  } catch (err) {
    console.error('[Error] POST /api/orders/allocate failure:', err);
    res.status(500).json({ success: false, error: err.message || 'Order allocation failed' });
  }
});

// Farmer accepts allocation
app.post('/api/allocations/:id/accept', async (req, res) => {
  try {
    const user = getReqUser(req);
    const result = await listingStore.acceptAllocation(req.params.id, user.id);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Error] POST /api/allocations/:id/accept failure:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Farmer rejects allocation -> automatic reallocation
app.post('/api/allocations/:id/reject', async (req, res) => {
  try {
    const user = getReqUser(req);
    const result = await listingStore.rejectAllocation(req.params.id, user.id);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Error] POST /api/allocations/:id/reject failure:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const user = getReqUser(req);
    const query = { ...req.query };
    if (!query.buyerId && user.role === 'buyer' && user.id) {
      query.buyerId = user.id;
    }
    if (!query.farmerId && user.role === 'farmer' && user.id) {
      query.farmerId = user.id;
    }
    const orders = await listingStore.getAllOrders(query);
    res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    console.error('[Error] GET /api/orders failure:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve orders' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const user = getReqUser(req);
    const requirement = {
      crop: req.body.crop,
      quantity: req.body.quantity || req.body.quantityKg,
      variety: req.body.variety,
      maxPrice: req.body.pricePerKg,
      buyerLocation: req.body.buyerLocation || user.location,
    };
    const result = await listingStore.createMultiFarmerOrder({
      requirement,
      buyerSession: user,
    });
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.status(201).json({ success: true, order: result.order });
  } catch (err) {
    console.error('[Error] POST /api/orders failure:', err);
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

app.post('/api/orders/reset', async (req, res) => {
  try {
    await listingStore.resetOrders();
    res.json({ success: true, message: 'Orders reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Calibrates produce quality score based on defect severity and visible physical evidence.
// Strictly separates photographic artifacts (lighting, shadows, clutter) from genuine crop health.
function calibrateProduceQualityScore(rawScore, defectSeverity) {
  let score = typeof rawScore === 'number' && !isNaN(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 75;
  const severity = String(defectSeverity || '').toUpperCase().trim();

  if (severity === 'NONE') {
    // Defect-free, clean, mature produce: must be Grade A (90-100)
    // If photographic lighting or camera blur caused raw score to drift below 90, elevate to Grade A.
    return score < 90 ? Math.max(92, score) : score;
  }

  if (severity === 'MAJOR') {
    // Visible rot, mold, deep cuts, or pest infestation: must be Grade C (<75)
    return score >= 75 ? Math.min(68, score) : score;
  }

  if (severity === 'MINOR') {
    // Only minor superficial cosmetic blemishes: must be Grade B (75-89)
    if (score < 75) return 78;
    if (score >= 90) return 86;
    return score;
  }

  return score;
}

// Exponential backoff retry handler for transient Groq errors
// Retries rate-limit (429), intermittent json_validate_failed (400), and transient gateway errors (500/502/503).
// Never retries 401 invalid API key errors.
async function invokeGroqWithRetry(fn, maxRetries = 3) {
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Do not retry invalid API key errors (401)
      const isAuthError =
        err.status === 401 ||
        err.statusCode === 401 ||
        err.message?.includes('invalid_api_key') ||
        err.message?.includes('API key') ||
        err.code === 'invalid_api_key';

      if (isAuthError) {
        throw err;
      }

      // Check if error is transient JSON validation failure from Groq reasoning models
      const isJsonValidateFailed =
        (err.status === 400 || err.statusCode === 400) &&
        (err.code === 'json_validate_failed' ||
         err.message?.includes('json_validate_failed') ||
         err.message?.includes('max completion tokens') ||
         err.message?.includes('Failed to validate JSON'));

      // Check if error is transient 429 rate limit
      const isRateLimit =
        err.status === 429 ||
        err.statusCode === 429 ||
        err.message?.includes('rate_limit') ||
        err.message?.includes('429') ||
        err.code === 'rate_limit_exceeded';

      // Check if transient server/network error (500, 502, 503)
      const isTransientServer =
        err.status === 500 ||
        err.status === 502 ||
        err.status === 503 ||
        err.statusCode === 500 ||
        err.statusCode === 502 ||
        err.statusCode === 503;

      const shouldRetry = (isRateLimit || isJsonValidateFailed || isTransientServer) && attempt < maxRetries;

      if (shouldRetry) {
        const delayMs = process.env.TEST_FAST_RETRY ? 50 : (delays[attempt] || Math.pow(2, attempt) * 1000);
        const delayLabel = process.env.TEST_FAST_RETRY ? `${delayMs}ms` : `~${Math.round(delayMs / 1000)}s`;
        const reason = isJsonValidateFailed
          ? 'JSON validation token limit hit (json_validate_failed)'
          : isRateLimit
          ? 'Rate limit encountered (429)'
          : `Transient server error (${err.status || err.statusCode})`;

        console.warn(
          `[Groq AI] ${reason}. Retrying attempt ${attempt + 1}/${maxRetries} after ${delayLabel} backoff...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      // Re-throw if exhausted retries or not a retryable error
      throw err;
    }
  }
}

// Validates and normalizes produce inspection images into standard data URLs for Groq Vision
function sanitizeAndValidateProduceImage(image, mimeType) {
  if (!image || typeof image !== 'string') {
    return {
      valid: false,
      status: 400,
      code: 'MISSING_IMAGE_PAYLOAD',
      error: 'Missing image payload.',
    };
  }

  const trimmed = image.trim();
  let mime = 'image/jpeg';
  let base64 = '';

  if (trimmed.startsWith('data:')) {
    // Matches data:image/...;base64, handling any parameters
    const headerMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9+.-]+)(?:;[a-zA-Z0-9=._-]+)*;base64,/i);
    if (!headerMatch) {
      return {
        valid: false,
        status: 400,
        code: 'INVALID_IMAGE_DATA_URL',
        error: 'Invalid image data URL format. Expected data:image/<type>;base64,<data>',
      };
    }
    const detectedMime = headerMatch[1].toLowerCase();
    mime = detectedMime === 'image/jpg' ? 'image/jpeg' : detectedMime;
    // Extract base64 and strip all internal whitespaces/newlines
    base64 = trimmed.slice(headerMatch[0].length).replace(/\s+/g, '');
  } else {
    // Raw base64 string provided without data: prefix
    base64 = trimmed.replace(/\s+/g, '');
    if (mimeType && typeof mimeType === 'string') {
      const cleanMime = mimeType.trim().toLowerCase();
      mime = cleanMime === 'image/jpg' ? 'image/jpeg' : (cleanMime.startsWith('image/') ? cleanMime : `image/${cleanMime}`);
    }
  }

  const supportedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!supportedMimes.includes(mime)) {
    return {
      valid: false,
      status: 400,
      code: 'UNSUPPORTED_IMAGE_FORMAT',
      error: `Unsupported image format (${mime}). Allowed formats: JPEG, PNG, WEBP, GIF.`,
    };
  }

  if (!base64 || base64.length === 0) {
    return {
      valid: false,
      status: 400,
      code: 'EMPTY_IMAGE_BUFFER',
      error: 'Empty image buffer.',
    };
  }

  // Calculate estimated decoded bytes: base64 length * 3 / 4
  const estimatedBytes = Math.round((base64.length * 3) / 4);
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB limit
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    return {
      valid: false,
      status: 400,
      code: 'IMAGE_TOO_LARGE',
      error: `Image size (${(estimatedBytes / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 8MB.`,
    };
  }

  // Guarantee clean data URL with intact MIME prefix
  const dataUrl = `data:${mime};base64,${base64}`;

  return {
    valid: true,
    dataUrl,
    mime,
    sizeBytes: estimatedBytes,
  };
}

// Extracts balanced curly braces from string starting at startIndex
function extractBalancedBraces(str, startIndex) {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < str.length; i++) {
    const char = str[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return str.slice(startIndex, i + 1);
        }
      }
    }
  }

  // Fallback: if braces did not balance, find last '}'
  const lastClose = str.lastIndexOf('}');
  if (lastClose > startIndex) {
    return str.slice(startIndex, lastClose + 1);
  }

  return null;
}

// Extracts the first balanced JSON object from arbitrary text containing reasoning or markdown
function extractFirstJsonObject(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. Strip think/thought tags first (including unclosed tags)
  const clean = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/<thought>[\s\S]*?(?:<\/thought>|$)/gi, '')
    .trim();

  // 2. If markdown code fence exists, try inside code fence first
  const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const searchSpace = fenceMatch ? fenceMatch[1].trim() : clean;

  const firstOpen = searchSpace.indexOf('{');
  if (firstOpen === -1) {
    const fallbackOpen = clean.indexOf('{');
    if (fallbackOpen === -1) return null;
    return extractBalancedBraces(clean, fallbackOpen);
  }

  return extractBalancedBraces(searchSpace, firstOpen);
}

// Safely parses JSON with automatic repair for common LLM formatting artifacts
function parseJsonLenient(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch {
    const repaired = jsonStr
      .replace(/[\u201C\u201D]/g, '"') // smart double quotes
      .replace(/[\u2018\u2019]/g, "'") // smart single quotes
      .replace(/,\s*([}\]])/g, '$1') // trailing commas
      .replace(/:\s*True\b/g, ': true')
      .replace(/:\s*False\b/g, ': false')
      .replace(/:\s*None\b/g, ': null');

    return JSON.parse(repaired);
  }
}

// Normalizes grade safely to A, B, or C
function normalizeGrade(rawGrade, qualityScore) {
  if (typeof rawGrade === 'string') {
    const trimmed = rawGrade.trim().toUpperCase();
    const match = trimmed.match(/\b([ABC])\b/);
    if (match) {
      return match[1];
    }
  }
  if (typeof qualityScore === 'number' && !isNaN(qualityScore)) {
    return calculateDeterministicGrade(qualityScore);
  }
  return null;
}

// Normalizes observations field into an array of non-empty strings
function normalizeObservations(rawObs) {
  if (Array.isArray(rawObs)) {
    const arr = rawObs.map((o) => String(o).trim()).filter(Boolean);
    return arr.length > 0 ? arr : ['Physical inspection completed'];
  }
  if (typeof rawObs === 'string' && rawObs.trim().length > 0) {
    const lines = rawObs
      .split(/\n+/)
      .map((l) => l.replace(/^[-*•\d.]+\s*/, '').trim())
      .filter(Boolean);
    return lines.length > 0 ? lines : [rawObs.trim()];
  }
  return ['Physical inspection completed'];
}

// Fallback parser for pseudo-JSON formats (e.g. bulleted key-value lists emitted by reasoning models)
function parsePseudoJson(text) {
  if (!text || typeof text !== 'string') return null;
  const obj = {};
  const lines = text.split('\n');
  let hasAnyKey = false;
  for (const line of lines) {
    const match = line.match(/[*•-]?\s*['"]?([a-zA-Z0-9_]+)['"]?\s*:\s*(.+)/);
    if (match) {
      const key = match[1].trim();
      let valStr = match[2].trim().replace(/^['"]+|['"]+$/g, '');
      if (valStr.endsWith(',')) valStr = valStr.slice(0, -1).trim();

      if (['isProduce', 'isSuitable', 'qualityScore', 'grade', 'confidence', 'defectSeverity', 'cropIdentified', 'observations'].includes(key)) {
        hasAnyKey = true;
        if (valStr === 'true') obj[key] = true;
        else if (valStr === 'false') obj[key] = false;
        else if (valStr === 'null') obj[key] = null;
        else if (!isNaN(Number(valStr)) && valStr !== '') obj[key] = Number(valStr);
        else if (valStr.startsWith('[') && valStr.endsWith(']')) {
          try {
            obj[key] = JSON.parse(valStr.replace(/'/g, '"'));
          } catch {
            obj[key] = [valStr.slice(1, -1).trim()];
          }
        } else {
          obj[key] = valStr;
        }
      }
    }
  }
  return hasAnyKey && (obj.isProduce !== undefined || obj.qualityScore !== undefined) ? obj : null;
}

// Comprehensive parser and validator for model quality assessment outputs
function parseAndValidateAssessment(rawText, declaredCrop) {
  if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new Error('Empty response received from Groq Vision model.');
  }

  let parsed = null;
  const jsonChunk = extractFirstJsonObject(rawText);
  if (jsonChunk) {
    try {
      parsed = parseJsonLenient(jsonChunk);
    } catch {
      parsed = null;
    }
  }

  // Fallback: try parsing pseudo-JSON if jsonChunk extraction or parsing failed
  if (!parsed || typeof parsed !== 'object') {
    parsed = parsePseudoJson(rawText);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('No valid JSON or recognizable assessment structure found in model output.');
  }

  // Validate produce & suitability
  const isProduce = Boolean(parsed.isProduce);
  const isSuitable = Boolean(parsed.isSuitable);
  const cropIdentified = String(parsed.cropIdentified || declaredCrop || 'unknown').trim();

  // Normalize observations
  const observations = normalizeObservations(parsed.observations);

  // If unsuitable or not produce
  if (!isProduce || !isSuitable || parsed.qualityScore === null || parsed.qualityScore === undefined) {
    let conf = typeof parsed.confidence === 'number' ? parsed.confidence : 20;
    if (conf > 1) conf = conf / 100;
    return {
      status: 'UNSUITABLE',
      isProduce: false,
      isSuitable: false,
      cropIdentified: 'unknown',
      defectSeverity: null,
      qualityScore: null,
      grade: null,
      confidence: Math.max(0, Math.min(1, parseFloat(conf.toFixed(2)))),
      observations,
    };
  }

  // Normalize numeric qualityScore (clamped 0-100)
  let rawScore = parsed.qualityScore;
  if (typeof rawScore === 'string') {
    const numMatch = rawScore.match(/\d+/);
    rawScore = numMatch ? parseInt(numMatch[0], 10) : NaN;
  } else if (typeof rawScore === 'number') {
    rawScore = Math.round(rawScore);
  }

  if (typeof rawScore !== 'number' || isNaN(rawScore)) {
    const g = normalizeGrade(parsed.grade);
    if (g === 'A') rawScore = 92;
    else if (g === 'B') rawScore = 80;
    else if (g === 'C') rawScore = 65;
    else throw new Error('Missing or invalid qualityScore in model assessment.');
  }

  rawScore = Math.max(0, Math.min(100, rawScore));

  // Normalize grade safely
  const gradeExtracted = normalizeGrade(parsed.grade, rawScore);

  // Normalize defectSeverity or infer it if not provided
  let defectSeverity = parsed.defectSeverity;
  if (!defectSeverity) {
    if (gradeExtracted === 'A' || rawScore >= 90) defectSeverity = 'NONE';
    else if (gradeExtracted === 'B' || rawScore >= 75) defectSeverity = 'MINOR';
    else defectSeverity = 'MAJOR';
  }

  // Normalize confidence (clamped 0-100, mapped to decimal for frontend)
  let rawConf = parsed.confidence;
  if (typeof rawConf === 'string') {
    const confMatch = rawConf.match(/[\d.]+/);
    rawConf = confMatch ? parseFloat(confMatch[0]) : NaN;
  }
  let confidenceVal = 85;
  if (typeof rawConf === 'number' && !isNaN(rawConf)) {
    confidenceVal = Math.max(0, Math.min(100, rawConf));
  }

  const confidence = confidenceVal > 1
    ? parseFloat((confidenceVal / 100).toFixed(2))
    : parseFloat(confidenceVal.toFixed(2));

  return {
    status: 'ASSESSED',
    isProduce: true,
    isSuitable: true,
    cropIdentified,
    defectSeverity,
    qualityScore: rawScore,
    grade: gradeExtracted,
    confidence,
    observations,
  };
}

// Quality check endpoint (Powered by Groq Vision)
app.post('/api/quality-check', async (req, res) => {
  try {
    const { crop, image, mimeType } = req.body;

    // 1. Validation of crop parameter
    const normalizedCrop = normalizeCropKey(crop);
    if (!normalizedCrop) {
      return res.status(400).json({
        success: false,
        error: `Invalid or unsupported crop. Must be one of: ${SUPPORTED_CROPS.join(', ')}`,
        code: 'UNSUPPORTED_CROP',
      });
    }

    // 2. Sanitize and validate image payload
    const imageResult = sanitizeAndValidateProduceImage(image, mimeType);
    if (!imageResult.valid) {
      return res.status(imageResult.status).json({
        success: false,
        error: imageResult.error,
        code: imageResult.code,
      });
    }

    // 3. Check Groq API key configuration
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey === 'your_groq_api_key_here' || apiKey.trim() === '') {
      return res.status(503).json({
        success: false,
        unconfigured: true,
        error: 'Groq API key not configured. Please set GROQ_API_KEY in your server environment.',
        code: 'GROQ_API_KEY_MISSING',
      });
    }

    // Initialize Groq client strictly on the backend
    const groq = new Groq({ apiKey });

    const promptText = `You are a certified agricultural produce grading inspector AI for the PRAGATI Indian farmer marketplace.
Your role is to inspect the photograph of harvested agricultural produce and determine an objective, fair, and calibrated physical quality score.
The declared crop is: "${crop}".

================================================================================
CRITICAL PRINCIPLE: SEPARATE CROP QUALITY FROM PHOTO/ENVIRONMENT QUALITY
================================================================================
1. CROP QUALITY (Drives "qualityScore"):
   - Evaluates ONLY the actual physical state of the produce: freshness, maturity, firmness, structural integrity, and absence of rot, fungal decay, disease, or deep physical damage.
   - Farm-fresh characteristics are EXPECTED and NORMAL in agricultural lots: harmless surface field soil/dust, natural stems or calyxes, and minor natural shape/size variations MUST NOT penalize the crop.
   - Produce that is healthy, clean or normally farm-handled, and ready for commercial sale belongs in GRADE A (90–100).

2. PHOTO / ENVIRONMENT QUALITY (Drives "confidence" ONLY):
   - Lighting conditions (dim light, harsh sunlight, uneven shadows), camera resolution, angle, focus, or farm background (gunny sacks, crates, soil, hands holding produce, wooden tables) are PHOTOGRAPHIC FACTORS.
   - These factors MUST ONLY adjust your "confidence" score (e.g., lower confidence to 0.70–0.85).
   - NEVER penalize "qualityScore" for poor lighting, shadows, or a cluttered background if the visible crop itself is healthy and sound!

================================================================================
EXPLICIT GRADE THRESHOLDS & EVIDENCE-BASED SCORING RUBRIC (0 to 100)
================================================================================
- GRADE A (Score 90–100) — Prime / Excellent Market Quality:
  * Produce is clearly healthy, firm, mature, and commercially prime.
  * Free from active rot, fungal growth, deep cuts, severe bruising, or pest infestation.
  * Natural field dust/soil that readily washes off, normal stem attachments, and mild natural shape variations are completely acceptable for Grade A.
  * If the produce has no clearly observable physical defects, set "defectSeverity": "NONE" and assign a score between 90 and 100.

- GRADE B (Score 75–89) — Standard Commercial / Good Quality:
  * Produce is wholesome, firm, and fully edible/marketable, but exhibits clearly visible minor cosmetic imperfections.
  * Qualifying minor imperfections include: minor superficial skin scarring, light surface scratches, slight discoloration, or moderate shape irregularity.
  * Must be completely free of active fungal/bacterial rot, soft decay, or deep open wounds.
  * Set "defectSeverity": "MINOR" and assign a score between 75 and 89.

- GRADE C (Score 0–74) — Substandard / Defective Quality:
  * Produce exhibits significant, serious, and tangible defects:
    - Active soft rot, mold, fungal sporulation, or bacterial decay.
    - Deep open cuts, severe crushing/bruising, leaking juices, or pest boreholes.
    - Advanced shriveling, severe wilting, or overripe decomposition.
  * Every point deduction into Grade C MUST be substantiated by concrete, unmistakable visible evidence.
  * Set "defectSeverity": "MAJOR" and assign a score between 0 and 74.

================================================================================
ANTI-HALLUCINATION & AMBIGUITY RULES
================================================================================
1. Visible Evidence Only: Deduct points ONLY for defects that you can explicitly see and point out. Never guess, assume, or fabricate defects on hidden sides or in shadowed zones.
2. Incomplete or Ambiguous Visibility: If shadows, glare, or camera angles obscure portions of the lot, evaluate what is visible. If unobserved portions cannot be verified, state "insufficient visual evidence for obscured portions" in your observations and adjust "confidence", but do NOT invent defects or downgrade the healthy visible crop.
3. Shadows vs Defects: Do NOT confuse cast shadows, glare, camera flash highlights, or normal color gradients of ripening with dark rot spots or bruising.
4. Produce Suitability: If the image does NOT depict agricultural produce, is an entirely different crop, or is so severely corrupted/blurred that no produce can be identified, return "isProduce": false and "isSuitable": false.

================================================================================
CRITICAL OUTPUT FORMAT INSTRUCTIONS:
Return ONLY one valid JSON object.
Do not use markdown.
Do not use code fences.
Do not include <think> tags or reasoning.
Do not output markdown.
Do not output bullets.
Do not output reasoning.
Do not output <think>.
Do not output any text outside the JSON object.
================================================================================
Expected JSON format for suitable produce:
{
  "isProduce": true,
  "isSuitable": true,
  "qualityScore": 95,
  "grade": "A",
  "confidence": 90,
  "observations": [
    "Healthy crop appearance",
    "No visible major damage"
  ]
}

Expected JSON format for non-produce or unsuitable images:
{
  "isProduce": false,
  "isSuitable": false,
  "qualityScore": null,
  "grade": null,
  "confidence": 20,
  "observations": [
    "Image does not depict the declared agricultural crop or lacks sufficient visual clarity."
  ]
}
================================================================================
GRADE SCORING REFERENCE:
- GRADE A: score 90-100, defectSeverity NONE
- GRADE B: score 75-89, defectSeverity MINOR
- GRADE C: score 0-74, defectSeverity MAJOR
================================================================================`;

    const candidateVisionModels = [
      GROQ_VISION_MODEL_ID,
      'qwen/qwen3.6-27b',
      'qwen/qwen3.8-27b',
    ].filter((m, i, arr) => m && arr.indexOf(m) === i);

    let chatCompletion = null;
    let usedModel = GROQ_VISION_MODEL_ID;

    for (let i = 0; i < candidateVisionModels.length; i++) {
      const modelToTry = candidateVisionModels[i];
      try {
        console.log(`[Groq Vision] Invoking ${modelToTry} for crop: ${crop}...`);
        chatCompletion = await invokeGroqWithRetry(() =>
          groq.chat.completions.create({
            model: modelToTry,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: promptText },
                  {
                    type: 'image_url',
                    image_url: {
                      url: imageResult.dataUrl,
                    },
                  },
                ],
              },
            ],
            response_format: {
              type: 'json_object',
            },
            reasoning_format: 'hidden',
            temperature: 0.1,
            max_completion_tokens: 3500,
          })
        );
        usedModel = modelToTry;
        break;
      } catch (callErr) {
        const isModelNotFoundError =
          callErr.status === 404 ||
          callErr.code === 'model_not_found' ||
          callErr.message?.includes('model_not_found') ||
          callErr.message?.includes('does not exist') ||
          callErr.message?.includes('decommissioned');

        if (isModelNotFoundError && i < candidateVisionModels.length - 1) {
          console.warn(
            `[Groq Vision] Model ${modelToTry} unavailable (${callErr.message}). Falling back to ${candidateVisionModels[i + 1]}...`
          );
          continue;
        }
        throw callErr;
      }
    }

    const rawText = chatCompletion?.choices?.[0]?.message?.content || '';
    console.log('[Groq Vision] Raw response received.');

    // 4. Safely extract and parse JSON from model output using robust parser
    let parsedResult = null;
    try {
      parsedResult = parseAndValidateAssessment(rawText, crop);
    } catch (parseErr) {
      console.error('[Groq Vision] Failed to parse model JSON output:', {
        model: usedModel,
        error: parseErr.message,
        rawPreview: (rawText || '').slice(0, 500).replace(/gsk_[a-zA-Z0-9_-]+/g, '[REDACTED]'),
      });
      return res.status(502).json({
        success: false,
        error: 'Model returned malformed assessment output.',
        code: 'MALFORMED_MODEL_OUTPUT',
        details: parseErr.message,
        rawText: (rawText || '').slice(0, 300),
      });
    }

    // 5. Handle Unsuitable / Non-Produce image gracefully
    if (!parsedResult.isProduce || !parsedResult.isSuitable || parsedResult.qualityScore === null) {
      return res.json({
        success: true,
        status: 'UNSUITABLE',
        crop,
        cropIdentified: parsedResult.cropIdentified || 'unknown',
        isProduce: false,
        isSuitable: false,
        message: 'The uploaded photo does not appear to match the selected crop or is too blurry to evaluate reliably.',
        qualityScore: null,
        grade: null,
        confidence: parsedResult.confidence,
        observations: parsedResult.observations,
        model: usedModel,
        assessedAt: new Date().toISOString(),
      });
    }

    // 6. Calibrate produce quality score and deterministic grading
    const qualityScore = calibrateProduceQualityScore(parsedResult.qualityScore, parsedResult.defectSeverity);
    const finalGrade = calculateDeterministicGrade(qualityScore);

    return res.json({
      success: true,
      status: 'ASSESSED',
      crop,
      cropIdentified: parsedResult.cropIdentified,
      isProduce: true,
      isSuitable: true,
      qualityScore,
      grade: finalGrade,
      confidence: parsedResult.confidence,
      observations: parsedResult.observations,
      model: usedModel,
      assessedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Error] /api/quality-check failure:', err.name, err.message);

    // Authentication Error (Invalid API Key)
    if (
      err.status === 401 ||
      err.statusCode === 401 ||
      err.code === 'invalid_api_key' ||
      err.message?.includes('invalid_api_key') ||
      err.message?.includes('API key')
    ) {
      return res.status(401).json({
        success: false,
        error: 'Groq API key is invalid. Please check GROQ_API_KEY in your server environment.',
        code: 'GROQ_API_KEY_INVALID',
      });
    }

    // Rate Limit / Quota Error (429)
    if (
      err.status === 429 ||
      err.statusCode === 429 ||
      err.code === 'rate_limit_exceeded' ||
      err.message?.includes('rate_limit') ||
      err.message?.includes('429')
    ) {
      return res.status(429).json({
        success: false,
        error: 'Groq rate limit exceeded. Please wait a moment before trying again.',
        code: 'GROQ_RATE_LIMITED',
      });
    }

    // Model Not Found / Decommissioned Error (404)
    if (
      err.status === 404 ||
      err.statusCode === 404 ||
      err.code === 'model_not_found' ||
      err.message?.includes('model_not_found') ||
      err.message?.includes('does not exist') ||
      err.message?.includes('decommissioned')
    ) {
      return res.status(404).json({
        success: false,
        error: 'The requested Groq Vision model is currently unavailable or decommissioned. Please check GROQ_VISION_MODEL_ID.',
        code: 'GROQ_MODEL_NOT_FOUND',
        details: err.message,
      });
    }

    // JSON Validation / Generation Failure (400 from Groq reasoning model)
    const isJsonValidateFailed =
      err.code === 'json_validate_failed' ||
      err.message?.includes('json_validate_failed') ||
      err.message?.includes('max completion tokens') ||
      err.message?.includes('Failed to validate JSON');

    if (isJsonValidateFailed) {
      return res.status(502).json({
        success: false,
        error: 'AI quality assessment model reached token limit during generation. Please try again.',
        code: 'GROQ_JSON_VALIDATION_FAILED',
        details: err.message,
      });
    }

    // Bad Request / Invalid Image Payload (400)
    if (
      err.status === 400 ||
      err.statusCode === 400 ||
      err.name === 'BadRequestError' ||
      err.message?.includes('400')
    ) {
      return res.status(400).json({
        success: false,
        error: 'Groq Vision rejected the request or image payload. Please ensure the photo is a valid JPEG/PNG image.',
        code: 'GROQ_BAD_REQUEST',
        details: err.message,
      });
    }

    // Service Unavailable / Gateway Error (500 / 502 / 503 / 504 from Groq)
    if (
      err.status === 503 ||
      err.status === 502 ||
      err.status === 504 ||
      err.status === 500 ||
      err.name === 'InternalServerError' ||
      err.name === 'APIConnectionError'
    ) {
      return res.status(503).json({
        success: false,
        error: 'Groq AI service is temporarily unavailable. Please try again in a moment.',
        code: 'GROQ_SERVICE_UNAVAILABLE',
        details: err.message,
      });
    }

    // Fallback Internal Error
    return res.status(500).json({
      success: false,
      error: 'An internal error occurred during produce quality assessment.',
      code: 'INTERNAL_ASSESSMENT_ERROR',
      details: err.message,
    });
  }
});

// AI Voice Assistant Endpoint (Powered by Groq)
app.post('/api/voice-assistant', async (req, res) => {
  try {
    const { message, language = 'en', context } = req.body;

    // 1. Validation of input message
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing or empty message in request payload.',
      });
    }

    // 2. Check Groq API key configuration
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey === 'your_groq_api_key_here' || apiKey.trim() === '') {
      return res.status(503).json({
        success: false,
        unconfigured: true,
        error: 'Groq API key not configured. Please set GROQ_API_KEY in your server environment.',
        code: 'GROQ_API_KEY_MISSING',
      });
    }

    // 3. Initialize Groq client
    const groq = new Groq({ apiKey });

    // 4. Build prompt with system instructions and user context
    const langNote = (language === 'hi' || /[\u0900-\u097F]/.test(message))
      ? 'The user is communicating in Hindi. Respond in clear, natural Hindi (Devanagari or simple Hinglish where appropriate).'
      : 'The user is communicating in English. Respond in clear, concise English.';

    let contextSnippet = '';
    if (context && typeof context === 'object') {
      contextSnippet = '\nAPPLICATION CONTEXT:\n' + JSON.stringify(context, null, 2);
    }

    const systemInstruction = `You are an agricultural marketplace assistant for an Indian farmer marketplace named PRAGATI.
Give concise, practical answers (usually 2 to 4 sentences or bullet points) suitable for text-to-speech.
${langNote}
Never invent live market prices, government schemes, weather data, or market data.
Use information already available in the user's question and application context.
If information is unavailable, clearly say so.
Help farmers understand selling, fair pricing, quality grades, buyer matching, pickup, aggregation and logistics.

CRITICAL RULES:
1. Do NOT claim you have live mandi prices. If the user asks for today's or live mandi prices, explicitly clarify that live mandi price feeds are not currently integrated into this MVP, and share only the platform's benchmark pricing guidance if applicable.
2. Produce Quality: Grades are deterministic: Grade A (90-100% premium quality), Grade B (75-89% good commercial quality), Grade C (<75% fair quality).
3. Smart Pickup Rules: Thresholds are Wheat 100kg, Rice 100kg, Potato 75kg, Onion 75kg, Tomato 30kg, Fruits 30kg. Lots <= threshold go to HUB PICKUP; lots > threshold go to DIRECT FARM/HOME PICKUP.
4. Hub Aggregation: When multiple farmers have the same crop with HUB pickup, their lots are grouped together at the local hub with quantity-weighted pricing.
5. Logistics: Routes from hub to buyers are optimized using nearest-neighbor sequence.
6. Selling & Buying: Farmers can list produce with photos and get AI quality + fair price. Buyers can browse marketplace and place orders directly.`;

    const userPrompt = contextSnippet
      ? `${contextSnippet}\n\nUser Question: ${message.trim()}`
      : message.trim();

    // Call Groq completions with exponential backoff retry for transient 429 errors
    // and automatic fallback if the configured model is unavailable/decommissioned (404 model_not_found)
    const candidateModels = [
      GROQ_MODEL_ID,
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
    ].filter((m, i, arr) => m && arr.indexOf(m) === i);

    let chatCompletion = null;
    let usedModel = GROQ_MODEL_ID;

    for (let i = 0; i < candidateModels.length; i++) {
      const modelToTry = candidateModels[i];
      try {
        console.log(`[Groq Voice Assistant] Invoking ${modelToTry} for query: "${message.slice(0, 50)}"...`);
        chatCompletion = await invokeGroqWithRetry(() =>
          groq.chat.completions.create({
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: userPrompt },
            ],
            model: modelToTry,
            temperature: 0.3,
            max_tokens: 600,
          })
        );
        usedModel = modelToTry;
        break;
      } catch (callErr) {
        const isModelNotFoundError =
          callErr.status === 404 ||
          callErr.code === 'model_not_found' ||
          callErr.message?.includes('model_not_found') ||
          callErr.message?.includes('does not exist') ||
          callErr.message?.includes('decommissioned');

        if (isModelNotFoundError && i < candidateModels.length - 1) {
          console.warn(
            `[Groq Voice Assistant] Model ${modelToTry} unavailable (${callErr.message}). Falling back to ${candidateModels[i + 1]}...`
          );
          continue;
        }
        throw callErr;
      }
    }

    const answer = chatCompletion?.choices?.[0]?.message?.content?.trim() || 'I could not generate an answer at this time. Please try again.';
    console.log('[Groq Voice Assistant] Response successfully generated.');

    return res.json({
      success: true,
      answer,
      model: usedModel,
    });
  } catch (err) {
    console.error('[Error] /api/voice-assistant failure:', err.name, err.message);

    // Authentication Error (Invalid API Key)
    if (
      err.status === 401 ||
      err.message?.includes('invalid_api_key') ||
      err.message?.includes('API key') ||
      err.code === 'invalid_api_key'
    ) {
      return res.status(401).json({
        success: false,
        error: 'Groq API key is invalid. Please check GROQ_API_KEY in your server environment.',
        code: 'GROQ_API_KEY_INVALID',
      });
    }

    // Rate Limit / Quota Error (429)
    if (
      err.status === 429 ||
      err.message?.includes('rate_limit') ||
      err.message?.includes('429') ||
      err.code === 'rate_limit_exceeded'
    ) {
      return res.status(429).json({
        success: false,
        error: 'Groq rate limit exceeded. Please wait a moment before trying again.',
        code: 'GROQ_RATE_LIMITED',
      });
    }

    // Model Not Found / Decommissioned Error (404)
    if (
      err.status === 404 ||
      err.code === 'model_not_found' ||
      err.message?.includes('model_not_found') ||
      err.message?.includes('does not exist') ||
      err.message?.includes('decommissioned')
    ) {
      return res.status(404).json({
        success: false,
        error: 'The requested Groq model is currently unavailable or decommissioned. Please check GROQ_MODEL_ID.',
        code: 'GROQ_MODEL_NOT_FOUND',
        details: err.message,
      });
    }

    // Service Unavailable / 503
    if (err.status === 503) {
      return res.status(503).json({
        success: false,
        error: 'Groq service is temporarily unavailable. Please try again in a moment.',
        code: 'GROQ_SERVICE_UNAVAILABLE',
      });
    }

    return res.status(500).json({
      success: false,
      error: 'An internal error occurred while processing your voice query.',
      details: err.message,
    });
  }
});

export { app, calculateDeterministicGrade, invokeGroqWithRetry, calibrateProduceQualityScore, parseAndValidateAssessment };
export default app;

if (process.env.NODE_ENV !== 'test') {
  app.use(express.static(path.join(__dirname, 'dist')));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Produce Quality Check API listening on http://localhost:${PORT}`);
    console.log(`[Server] Provider: Groq | Voice: ${GROQ_MODEL_ID} | Vision: ${GROQ_VISION_MODEL_ID}`);
  });
}

// server.js - AI Produce Quality Inspection Backend
// Powered by Google Gemini Vision API & gemini-3.7-flash multimodal model

import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import Groq from 'groq-sdk';
import path from 'path';
import { fileURLToPath } from 'url';
import { listingStore } from './server/listingStore.js';
import {
  calculate7DayDemand,
  calculateAllCropsDemand,
  getTopDemandedCropsList,
  normalizeCropKey,
  CROP_7DAY_BASELINE_DEMAND,
} from './server/demandPredictor.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;
const GEMINI_MODEL_ID = process.env.GEMINI_MODEL_ID || 'gemini-3.7-flash';
const GROQ_MODEL_ID =
  process.env.GROQ_MODEL_ID &&
  process.env.GROQ_MODEL_ID !== 'llama-3.3-70b-versatile' &&
  process.env.GROQ_MODEL_ID !== 'llama-3.1-8b-instant'
    ? process.env.GROQ_MODEL_ID
    : 'openai/gpt-oss-20b';

// Limit JSON body payload size (supports base64 image up to 8MB)
app.use(express.json({ limit: '10mb' }));

const SUPPORTED_CROPS = ['wheat', 'rice', 'potato', 'onion', 'tomato', 'fruits'];

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
    provider: 'Google Gemini',
    model: GEMINI_MODEL_ID,
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
      id,
    } = req.body;

    if (!crop || !SUPPORTED_CROPS.includes(crop.toLowerCase())) {
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
      crop: crop.toLowerCase(),
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
// Orders API (Shared Marketplace Orders)
// -------------------------------------------------------------
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await listingStore.getAllOrders(req.query);
    res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    console.error('[Error] GET /api/orders failure:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve orders' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const newOrder = await listingStore.createOrder(req.body);
    res.status(201).json({ success: true, order: newOrder });
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

// Quality check endpoint
app.post('/api/quality-check', async (req, res) => {
  try {
    const { crop, image, mimeType } = req.body;

    // 1. Validation of input parameters
    if (!crop || !SUPPORTED_CROPS.includes(crop.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid or unsupported crop. Must be one of: ${SUPPORTED_CROPS.join(', ')}`,
      });
    }

    if (!image || typeof image !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing image payload.',
      });
    }

    // 2. Extract base64 and format
    let base64Data = '';
    let format = 'jpeg';

    if (image.startsWith('data:')) {
      const matches = image.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (!matches || matches.length < 3) {
        return res.status(400).json({
          success: false,
          error: 'Invalid image data URL format.',
        });
      }
      let rawFormat = matches[1].toLowerCase();
      if (rawFormat === 'jpg') rawFormat = 'jpeg';
      if (!['jpeg', 'png', 'webp', 'gif'].includes(rawFormat)) {
        return res.status(400).json({
          success: false,
          error: 'Unsupported image format. Allowed: JPEG, PNG, WEBP, GIF.',
        });
      }
      format = rawFormat;
      base64Data = matches[2];
    } else {
      base64Data = image;
      if (mimeType) {
        let rawFormat = mimeType.replace('image/', '').toLowerCase();
        if (rawFormat === 'jpg') rawFormat = 'jpeg';
        if (['jpeg', 'png', 'webp', 'gif'].includes(rawFormat)) {
          format = rawFormat;
        }
      }
    }

    if (!base64Data || base64Data.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Empty image buffer.',
      });
    }

    // 3. Check Gemini API key configuration
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here' || apiKey.trim() === '') {
      return res.status(503).json({
        success: false,
        unconfigured: true,
        error: 'Google Gemini API key not configured. Please set GEMINI_API_KEY in your server .env file.',
        code: 'GEMINI_API_KEY_MISSING',
      });
    }

    // Initialize GoogleGenAI client strictly on the backend
    const ai = new GoogleGenAI({ apiKey });

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
OUTPUT SCHEMA (Strictly Valid JSON)
================================================================================
For suitable produce:
{
  "isProduce": true,
  "isSuitable": true,
  "cropIdentified": "${crop}",
  "defectSeverity": "NONE",
  "qualityScore": 95,
  "confidence": 0.90,
  "observations": [
    "Physical Condition: Vibrant natural color, firm texture, and healthy skin integrity.",
    "Defect Assessment: No visible rot, deep cuts, pest boreholes, or fungal decay.",
    "Photo & Evidence: Photographic lighting is ambient/dim, but visible crop condition is sound; confidence calibrated accordingly with zero quality penalty."
  ]
}

For non-produce or unsuitable images:
{
  "isProduce": false,
  "isSuitable": false,
  "cropIdentified": "unknown",
  "defectSeverity": null,
  "qualityScore": null,
  "confidence": 0.20,
  "observations": [
    "Image does not depict the declared agricultural crop or lacks sufficient visual clarity."
  ]
}`;

    console.log(`[Gemini] Invoking ${GEMINI_MODEL_ID} for crop: ${crop}...`);

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL_ID,
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: `image/${format}`,
          },
        },
        promptText,
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const rawText = response?.text || '';
    console.log('[Gemini] Raw response received.');

    // 4. Safely extract and parse JSON
    let parsedResult = null;
    try {
      const cleanedText = rawText
        .replace(/^\s*```(?:json)?/i, '')
        .replace(/```\s*$/, '')
        .trim();
      parsedResult = JSON.parse(cleanedText);
    } catch (parseErr) {
      console.error('[Gemini] Failed to parse model JSON output:', parseErr.message, rawText);
      return res.status(502).json({
        success: false,
        error: 'Model returned malformed assessment output.',
        rawText: rawText.slice(0, 300),
      });
    }

    // 5. Validate model output structure
    const isProduce = Boolean(parsedResult.isProduce);
    const isSuitable = Boolean(parsedResult.isSuitable);
    const cropIdentified = String(parsedResult.cropIdentified || crop).trim();
    const confidence = typeof parsedResult.confidence === 'number'
      ? Math.max(0, Math.min(1, parseFloat(parsedResult.confidence.toFixed(2))))
      : 0.5;

    const observations = Array.isArray(parsedResult.observations) && parsedResult.observations.length > 0
      ? parsedResult.observations.map((o) => String(o).trim())
      : ['Visual inspection completed'];

    // Handle Unsuitable / Non-Produce image gracefully
    if (!isProduce || !isSuitable || parsedResult.qualityScore === null || parsedResult.qualityScore === undefined) {
      return res.json({
        success: true,
        status: 'UNSUITABLE',
        crop,
        cropIdentified: 'unknown',
        isProduce: false,
        isSuitable: false,
        message: 'The uploaded photo does not appear to match the selected crop or is too blurry to evaluate reliably.',
        qualityScore: null,
        grade: null,
        confidence,
        observations,
        model: GEMINI_MODEL_ID,
        assessedAt: new Date().toISOString(),
      });
    }

    // Valid quality score clamping (0 to 100) and defect severity calibration
    const rawScore = parseInt(parsedResult.qualityScore, 10);
    const defectSeverity = String(parsedResult.defectSeverity || '').trim();
    const qualityScore = calibrateProduceQualityScore(rawScore, defectSeverity);

    // 6. Application DETERMINISTIC Grading (Thresholds: A >= 90, B >= 75, C < 75)
    const finalGrade = calculateDeterministicGrade(qualityScore);

    return res.json({
      success: true,
      status: 'ASSESSED',
      crop,
      cropIdentified,
      isProduce: true,
      isSuitable: true,
      qualityScore,
      grade: finalGrade,
      confidence,
      observations,
      model: GEMINI_MODEL_ID,
      assessedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Error] /api/quality-check failure:', err.name, err.message);

    if (err.message?.includes('API_KEY_INVALID') || err.message?.includes('API key not valid') || (err.status === 400 && err.message?.includes('key'))) {
      return res.status(401).json({
        success: false,
        error: 'Google Gemini API key is invalid. Please check GEMINI_API_KEY in your server .env file.',
        code: 'GEMINI_API_KEY_INVALID',
      });
    }

    if (err.status === 429 || err.message?.includes('RESOURCE_EXHAUSTED') || err.message?.includes('quota')) {
      return res.status(429).json({
        success: false,
        error: 'Google Gemini rate limit / quota exceeded. Please wait a moment before trying again.',
        code: 'GEMINI_RATE_LIMITED',
      });
    }

    return res.status(500).json({
      success: false,
      error: 'An internal error occurred during produce quality assessment.',
      details: err.message,
    });
  }
});

// Exponential backoff retry handler for transient Groq 429/rate-limit errors
// Retries maximum 3 times with delays of approximately 1s, 2s, and 4s.
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
        err.message?.includes('invalid_api_key') ||
        err.message?.includes('API key') ||
        err.code === 'invalid_api_key';

      if (isAuthError) {
        throw err;
      }

      // Check if error is transient 429 rate limit
      const isRateLimit =
        err.status === 429 ||
        err.message?.includes('rate_limit') ||
        err.message?.includes('429') ||
        err.code === 'rate_limit_exceeded';

      if (isRateLimit && attempt < maxRetries) {
        const delayMs = process.env.TEST_FAST_RETRY ? 50 : (delays[attempt] || Math.pow(2, attempt) * 1000);
        const delayLabel = process.env.TEST_FAST_RETRY ? `${delayMs}ms` : `~${Math.round(delayMs / 1000)}s`;
        console.warn(
          `[Groq Voice Assistant] Rate limit encountered (429). Retrying attempt ${attempt + 1}/${maxRetries} after ${delayLabel} backoff...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      // Re-throw if exhausted retries or not a rate-limit error
      throw err;
    }
  }
}

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

export { app, calculateDeterministicGrade, invokeGroqWithRetry, calibrateProduceQualityScore };
export default app;

if (process.env.NODE_ENV !== 'test') {
  app.use(express.static(path.join(__dirname, 'dist')));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Produce Quality Check API listening on http://localhost:${PORT}`);
    console.log(`[Server] Provider: Google Gemini | Model: ${GEMINI_MODEL_ID}`);
  });
}

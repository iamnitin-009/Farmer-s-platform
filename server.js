// server.js - AI Produce Quality Inspection Backend
// Powered by Google Gemini Vision API & gemini-3.7-flash multimodal model

import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import { listingStore } from './server/listingStore.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;
const GEMINI_MODEL_ID = process.env.GEMINI_MODEL_ID || 'gemini-3.7-flash';

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

    const promptText = `You are an expert agricultural inspection AI specializing in visual quality assessment of fresh produce lots.
Your role is to strictly inspect the provided photograph of agricultural produce and evaluate its physical quality.
The declared crop is: "${crop}".

CRITICAL RULES:
1. Examine ONLY the physical contents visible in the image.
2. Verify whether the image actually depicts the declared crop (${crop}).
3. If the image is NOT agricultural produce, is an entirely different crop, or is too blurry/unclear to identify, return "isProduce": false and "isSuitable": false.
4. Assess visible physical quality characteristics:
   - Appearance, shape consistency, and size uniformity.
   - Visible damage, cuts, bruising, pest blemishes, skin cracks, or fungal/bacterial rot.
   - Discoloration, dark spots, greening, or uneven ripening.
   - Firmness / freshness vs shriveling, wilting, or drying.
5. Quality Score (0 to 100):
   - 90-100: Premium/Excellent quality. Highly uniform, fresh, defect-free.
   - 75-89: Good commercial quality. Minor cosmetic blemishes, no deep rot.
   - 0-74: Fair or substandard quality. Noticeable blemishes, damage, non-uniformity, or spoilage.
6. Provide an objective confidence score between 0.0 and 1.0 based on image focus, resolution, and lighting.
7. Provide 3 to 5 concise bullet-point observations describing specifically what is visually observable.
8. Output MUST be strictly valid JSON matching this schema:

{
  "isProduce": true,
  "isSuitable": true,
  "cropIdentified": "${crop}",
  "qualityScore": 85,
  "confidence": 0.92,
  "observations": [
    "Observation 1",
    "Observation 2",
    "Observation 3"
  ]
}

If unsuitable or not produce:
{
  "isProduce": false,
  "isSuitable": false,
  "cropIdentified": "unknown",
  "qualityScore": null,
  "confidence": 0.3,
  "observations": [
    "Image does not depict the declared crop or lacks visual clarity"
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

    // Valid quality score clamping (0 to 100)
    const rawScore = parseInt(parsedResult.qualityScore, 10);
    const qualityScore = isNaN(rawScore) ? 75 : Math.max(0, Math.min(100, rawScore));

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

// AI Voice Assistant Endpoint
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

    // 2. Check Gemini API key configuration
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here' || apiKey.trim() === '') {
      return res.status(503).json({
        success: false,
        unconfigured: true,
        error: 'Google Gemini API key not configured. Please set GEMINI_API_KEY in your server .env file.',
        code: 'GEMINI_API_KEY_MISSING',
      });
    }

    // 3. Initialize GoogleGenAI client
    const ai = new GoogleGenAI({ apiKey });

    // 4. Build prompt with system instructions and user context
    const langNote = (language === 'hi' || /[\u0900-\u097F]/.test(message))
      ? 'The user is communicating in Hindi. Respond in clear, natural Hindi (Devanagari or simple Hinglish where appropriate).'
      : 'The user is communicating in English. Respond in clear, concise English.';

    let contextSnippet = '';
    if (context && typeof context === 'object') {
      contextSnippet = '\nAPPLICATION CONTEXT:\n' + JSON.stringify(context, null, 2);
    }

    const systemInstruction = `You are an agricultural marketplace assistant for an Indian farmer marketplace.
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

    console.log(`[Gemini Voice Assistant] Invoking ${GEMINI_MODEL_ID} for query: "${message.slice(0, 50)}"...`);

    const contents = [
      systemInstruction,
      contextSnippet,
      `User Question: ${message.trim()}`,
    ].filter(Boolean);

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL_ID,
      contents,
      config: {
        temperature: 0.3,
        maxOutputTokens: 600,
      },
    });

    const answer = response?.text?.trim() || 'I could not generate an answer at this time. Please try again.';
    console.log('[Gemini Voice Assistant] Response successfully generated.');

    return res.json({
      success: true,
      answer,
      model: GEMINI_MODEL_ID,
    });
  } catch (err) {
    console.error('[Error] /api/voice-assistant failure:', err.name, err.message);

    if (
      err.message?.includes('API_KEY_INVALID') ||
      err.message?.includes('API key not valid') ||
      (err.status === 400 && err.message?.includes('key'))
    ) {
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
      error: 'An internal error occurred while processing your voice query.',
      details: err.message,
    });
  }
});

export { app, calculateDeterministicGrade };
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

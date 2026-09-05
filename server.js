// server.js - AI Produce Quality Inspection Backend
// Powered by Google Gemini Vision API & gemini-3.7-flash multimodal model

import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

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
    service: 'AI Produce Quality Check',
    provider: 'Google Gemini',
    model: GEMINI_MODEL_ID,
  });
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
  app.listen(PORT, () => {
    console.log(`[Server] Produce Quality Check API listening on http://localhost:${PORT}`);
    console.log(`[Server] Provider: Google Gemini | Model: ${GEMINI_MODEL_ID}`);
  });
}

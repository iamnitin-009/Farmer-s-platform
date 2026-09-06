// server/demandPredictor.js
// Deterministic 7-Day Crop Demand Forecasting Engine for PRAGATI Agricultural Marketplace
// Time-windowed velocity forecasting with crop-specific benchmarks and low-data fallback.

export const SUPPORTED_CROPS = ['Wheat', 'Rice', 'Potato', 'Onion', 'Tomato', 'Fruits'];

// ============================================================================
// DEMO/BASELINE VALUES: Realistic 7-day regional demand benchmarks (in kg)
// for Indian agricultural mandis and local collection hubs.
// Used as fallback when real platform order history is zero or too small.
// ============================================================================
export const CROP_7DAY_BASELINE_DEMAND = {
  wheat: 1200,   // High-volume staple grain (~12 quintals per hub/week)
  rice: 1000,    // Primary staple cereal (~10 quintals per hub/week)
  potato: 750,   // High-consumption tuber staple (~7.5 quintals per hub/week)
  onion: 600,    // High daily turnover vegetable (~6 quintals per hub/week)
  tomato: 450,   // Perishable vegetable with continuous daily replenishment (~4.5 quintals per hub/week)
  fruits: 350,   // Perishable mixed seasonal fruits (~3.5 quintals per hub/week)
};

// Backward-compatibility alias
export const CROP_BASELINE_DEMAND = CROP_7DAY_BASELINE_DEMAND;

const CROP_ALIASES = {
  wheat: 'wheat',
  gehu: 'wheat',
  'गेहूं': 'wheat',
  'गेहू': 'wheat',
  rice: 'rice',
  chawal: 'rice',
  paddy: 'rice',
  'चावल': 'rice',
  potato: 'potato',
  aloo: 'potato',
  alu: 'potato',
  'आलू': 'potato',
  onion: 'onion',
  pyaz: 'onion',
  pyaaz: 'onion',
  'प्याज': 'onion',
  tomato: 'tomato',
  tamatar: 'tomato',
  'टमाटर': 'tomato',
  fruits: 'fruits',
  fruit: 'fruits',
  fal: 'fruits',
  'फल': 'fruits',
};

const CROP_DISPLAY_NAMES = {
  wheat: 'Wheat',
  rice: 'Rice',
  potato: 'Potato',
  onion: 'Onion',
  tomato: 'Tomato',
  fruits: 'Fruits',
};

/**
 * Safely normalize crop input string to standard supported key
 */
export function normalizeCropKey(crop) {
  if (!crop || typeof crop !== 'string') return null;
  const cleaned = crop.toLowerCase().trim();
  return CROP_ALIASES[cleaned] || null;
}

/**
 * Extract numerical valid quantity from an order record
 */
function extractQuantityKg(order) {
  if (!order || typeof order !== 'object') return 0;
  const qty = typeof order.quantityKg === 'number'
    ? order.quantityKg
    : typeof order.quantity === 'number'
      ? order.quantity
      : parseFloat(order.quantityKg || order.quantity || 0);
  return !isNaN(qty) && qty > 0 ? qty : 0;
}

/**
 * Build transparent bilingual explanation based on data source and trend
 */
function buildExplanation({ cropName, predictedDemand, dataSource, trendPercent, lang = 'en', orderCount = 0 }) {
  const isHi = lang === 'hi';

  if (dataSource === 'baseline_estimate') {
    return isHi
      ? `क्षेत्रीय मंडी खपत के आधार पर अगले 7 दिनों के लिए ${cropName} की अनुमानित मांग ${predictedDemand.toLocaleString()} kg है (आधारभूत अनुमान)।`
      : `Projected 7-day demand is ${predictedDemand.toLocaleString()} kg based on regional mandi consumption benchmarks (baseline estimate).`;
  }

  if (dataSource === 'limited_marketplace_data') {
    return isHi
      ? `प्रारंभिक ${orderCount} ऑर्डरों और मंडी आधारभूत रुझानों के आधार पर अगले 7 दिनों में मांग ~${predictedDemand.toLocaleString()} kg अनुमानित है।`
      : `Demand is estimated at ~${predictedDemand.toLocaleString()} kg for the next 7 days combining ${orderCount} early platform order(s) with regional benchmarks.`;
  }

  // Strong marketplace orders
  if (trendPercent >= 15) {
    return isHi
      ? `हाल के ऑर्डरों में मांग तेजी से बढ़ रही है (+${trendPercent}%)। अगले 7 दिनों में ${predictedDemand.toLocaleString()} kg की अपेक्षित बिक्री है।`
      : `Demand is trending strongly upward (+${trendPercent}%) across confirmed marketplace orders. Projected 7-day volume: ${predictedDemand.toLocaleString()} kg.`;
  }

  if (trendPercent <= -15) {
    return isHi
      ? `हाल के ऑर्डरों में मांग में गिरावट (${trendPercent}%) देखी गई है। अगले 7 दिनों की अनुमानित मांग ${predictedDemand.toLocaleString()} kg है।`
      : `Order momentum has softened (${trendPercent}%). Projected 7-day marketplace demand: ${predictedDemand.toLocaleString()} kg.`;
  }

  return isHi
    ? `नियमित खरीदार ऑर्डरों के आधार पर अगले 7 दिनों में मांग स्थिर (${predictedDemand.toLocaleString()} kg) बनी हुई है।`
    : `Market demand is steady based on regular confirmed orders. Projected 7-day volume: ${predictedDemand.toLocaleString()} kg.`;
}

/**
 * Build actionable recommendation based on demand level
 */
function buildRecommendation(demandLevel, lang = 'en') {
  const isHi = lang === 'hi';

  if (demandLevel === 'HIGH') {
    return isHi
      ? 'उच्च मांग — उपज सूचीबद्ध करने और प्रतिस्पर्धी लाभ लेने का यह सर्वोत्तम समय है।'
      : 'High demand — favorable market window to list produce at premium rates.';
  }

  if (demandLevel === 'MEDIUM') {
    return isHi
      ? 'मध्यम मांग — नियमित बिक्री के लिए प्रतिस्पर्धी बाजार मूल्य पर सूचीबद्ध करें।'
      : 'Moderate demand — list harvest with competitive pricing for steady turnaround.';
  }

  return isHi
    ? 'कम मांग — तत्काल बिक्री के लिए स्थानीय हब एकत्रीकरण या थोक सौदे पर विचार करें।'
    : 'Lower demand — consider local hub aggregation or flexible pricing for faster clearance.';
}

/**
 * Main 7-day demand forecasting function
 */
export function calculate7DayDemand({ crop, orders = [], listings = [], lang = 'en' } = {}) {
  const cropKey = normalizeCropKey(crop);

  if (!cropKey) {
    const isHi = lang === 'hi';
    return {
      crop: crop || 'Unknown',
      cropKey: 'unknown',
      predictedDemand: 0,
      predictedDemandKg: 0,
      unit: 'kg',
      horizon: '7_days',
      demandLevel: 'LOW',
      confidence: 0,
      hasEnoughData: false,
      explanation: isHi ? 'अमान्य या असमर्थित फसल।' : 'Invalid or unsupported crop.',
      recommendation: isHi ? 'कृपया एक समर्थित फसल का चयन करें।' : 'Please select a supported crop.',
      dataSource: 'unknown',
      benchmarkKg: 0,
      trendPercent: 0,
      orderCount: 0,
      historicalDemandKg: 0,
    };
  }

  const cropName = CROP_DISPLAY_NAMES[cropKey];
  const baseline7d = CROP_7DAY_BASELINE_DEMAND[cropKey] || 500;

  // Filter orders matching this crop
  const validOrders = Array.isArray(orders) ? orders : [];
  const cropOrders = validOrders.filter((order) => {
    if (!order) return false;
    const oCrop = normalizeCropKey(order.crop || order.cropName || order.listing?.crop);
    return oCrop === cropKey;
  });

  // Filter listings matching this crop (for supply context)
  const validListings = Array.isArray(listings) ? listings : [];
  const cropListings = validListings.filter((item) => {
    if (!item) return false;
    const lCrop = normalizeCropKey(item.crop);
    return lCrop === cropKey;
  });

  const orderCount = cropOrders.length;

  // --------------------------------------------------------------------------
  // SCENARIO 1: ZERO ORDERS (Low-Data Fallback to Crop-Specific Baseline)
  // --------------------------------------------------------------------------
  if (orderCount === 0) {
    const listingSupply = cropListings.reduce((s, item) => s + (parseFloat(item.quantity) || 0), 0);
    // Honest confidence: 30% default for zero transaction history; 35% if active farmer listings confirm regional activity
    const confidence = listingSupply > 0 ? 35 : 30;

    return {
      crop: cropName,
      cropKey,
      predictedDemand: baseline7d,
      predictedDemandKg: baseline7d,
      unit: 'kg',
      horizon: '7_days',
      demandLevel: 'MEDIUM', // Realistic baseline represents expected standard benchmark turnover
      confidence,
      hasEnoughData: false,
      explanation: buildExplanation({
        cropName,
        predictedDemand: baseline7d,
        dataSource: 'baseline_estimate',
        trendPercent: 0,
        lang,
        orderCount: 0,
      }),
      recommendation: buildRecommendation('MEDIUM', lang),
      dataSource: 'baseline_estimate',
      benchmarkKg: baseline7d,
      trendPercent: 0,
      orderCount: 0,
      historicalDemandKg: 0,
    };
  }

  // Extract chronological quantities and timestamps
  const chronologicalOrders = [...cropOrders].sort((a, b) => {
    const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tA - tB;
  });

  const quantities = chronologicalOrders
    .map(extractQuantityKg)
    .filter((q) => q > 0);

  const totalHistoricalVolumeKg = Math.round(quantities.reduce((sum, q) => sum + q, 0));
  const validOrderCount = quantities.length;

  if (validOrderCount === 0) {
    return {
      crop: cropName,
      cropKey,
      predictedDemand: baseline7d,
      predictedDemandKg: baseline7d,
      unit: 'kg',
      horizon: '7_days',
      demandLevel: 'MEDIUM',
      confidence: 30,
      hasEnoughData: false,
      explanation: buildExplanation({
        cropName,
        predictedDemand: baseline7d,
        dataSource: 'baseline_estimate',
        trendPercent: 0,
        lang,
        orderCount: 0,
      }),
      recommendation: buildRecommendation('MEDIUM', lang),
      dataSource: 'baseline_estimate',
      benchmarkKg: baseline7d,
      trendPercent: 0,
      orderCount: 0,
      historicalDemandKg: 0,
    };
  }

  // --------------------------------------------------------------------------
  // SCENARIO 2 & 3: TIME-WINDOWED VELOCITY CALCULATION
  // --------------------------------------------------------------------------
  // Determine time span of orders in days (min 1 day, max 30 days)
  const firstTime = chronologicalOrders[0]?.createdAt ? new Date(chronologicalOrders[0].createdAt).getTime() : Date.now();
  const lastTime = chronologicalOrders[chronologicalOrders.length - 1]?.createdAt
    ? new Date(chronologicalOrders[chronologicalOrders.length - 1].createdAt).getTime()
    : Date.now();

  const elapsedMs = Math.max(0, lastTime - firstTime);
  const elapsedDays = Math.max(1, Math.min(30, elapsedMs / (1000 * 60 * 60 * 24)));

  // Daily demand velocity (kg/day)
  const dailyVelocity = totalHistoricalVolumeKg / elapsedDays;

  // Unadjusted 7-day projection from velocity
  const raw7dVelocityDemand = dailyVelocity * 7;

  // Trend calculation when at least 3 orders exist
  let trendPercent = 0;
  let trendMultiplier = 1.0;

  if (validOrderCount >= 3) {
    const half = Math.floor(validOrderCount / 2);
    const pastSlice = quantities.slice(0, half);
    const recentSlice = quantities.slice(half);

    const pastSum = pastSlice.reduce((s, q) => s + q, 0);
    const recentSum = recentSlice.reduce((s, q) => s + q, 0);

    const pastAvg = pastSlice.length > 0 ? pastSum / pastSlice.length : 1;
    const recentAvg = recentSlice.length > 0 ? recentSum / recentSlice.length : 1;

    if (pastAvg > 0) {
      const rawTrend = Math.round(((recentAvg - pastAvg) / pastAvg) * 100);
      trendPercent = Math.max(-80, Math.min(150, rawTrend));
      // Controlled trend multiplier bound to avoid wild swings (0.70 to 1.40)
      trendMultiplier = Math.max(0.70, Math.min(1.40, 1 + (trendPercent / 100)));
    }
  }

  const orderDrivenDemand7d = raw7dVelocityDemand * trendMultiplier;

  // --------------------------------------------------------------------------
  // BAYESIAN SMOOTHING / BLENDING WEIGHT
  // When orders are few (1-5), blend sample velocity with realistic crop baseline
  // When orders >= 6, 100% driven by real market orders
  // --------------------------------------------------------------------------
  const dataWeight = Math.min(1.0, validOrderCount / 6);
  const blendedPredictedDemand = Math.round((dataWeight * orderDrivenDemand7d) + ((1 - dataWeight) * baseline7d));
  const finalPredictedDemand = Math.max(50, blendedPredictedDemand);

  // Crop-specific normalization against benchmark:
  // Ratio = predictedDemand / baseline7d
  const ratio = baseline7d > 0 ? finalPredictedDemand / baseline7d : 1.0;

  let demandLevel = 'MEDIUM';
  if (ratio >= 1.15) {
    demandLevel = 'HIGH';
  } else if (ratio < 0.75) {
    demandLevel = 'LOW';
  }

  // Honest confidence scoring:
  // 1-2 orders: 45-55%
  // 3-5 orders: 60-72%
  // 6+ orders: 75-85% (capped at 85%)
  let confidence = 45;
  let dataSource = 'limited_marketplace_data';

  if (validOrderCount >= 6) {
    confidence = Math.min(85, 75 + Math.min(10, Math.floor((validOrderCount - 6) * 1.5)));
    dataSource = 'marketplace_orders';
  } else if (validOrderCount >= 3) {
    confidence = 60 + (validOrderCount * 2);
    dataSource = 'marketplace_orders';
  } else {
    confidence = 45 + (validOrderCount * 5); // 50% for 1 order, 55% for 2 orders
    dataSource = 'limited_marketplace_data';
  }

  return {
    crop: cropName,
    cropKey,
    predictedDemand: finalPredictedDemand,
    predictedDemandKg: finalPredictedDemand,
    unit: 'kg',
    horizon: '7_days',
    demandLevel,
    confidence,
    hasEnoughData: validOrderCount >= 2,
    explanation: buildExplanation({
      cropName,
      predictedDemand: finalPredictedDemand,
      dataSource,
      trendPercent,
      lang,
      orderCount: validOrderCount,
    }),
    recommendation: buildRecommendation(demandLevel, lang),
    dataSource,
    benchmarkKg: baseline7d,
    trendPercent,
    orderCount: validOrderCount,
    historicalDemandKg: totalHistoricalVolumeKg,
  };
}

/**
 * Forecasts demand across all 6 supported crops
 */
export function calculateAllCropsDemand({ orders = [], listings = [], lang = 'en' } = {}) {
  return SUPPORTED_CROPS.map((cropName) =>
    calculate7DayDemand({ crop: cropName, orders, listings, lang })
  );
}

/**
 * Returns top demanded crops sorted by demand level and predicted volume
 */
export function getTopDemandedCropsList(limit = 3, { orders = [], listings = [], lang = 'en' } = {}) {
  const all = calculateAllCropsDemand({ orders, listings, lang });
  const priorityScore = { HIGH: 3000, MEDIUM: 2000, LOW: 1000 };

  const sorted = [...all].sort((a, b) => {
    const scoreA = (priorityScore[a.demandLevel] || 0) + a.predictedDemand;
    const scoreB = (priorityScore[b.demandLevel] || 0) + b.predictedDemand;
    return scoreB - scoreA;
  });

  return sorted.slice(0, limit);
}

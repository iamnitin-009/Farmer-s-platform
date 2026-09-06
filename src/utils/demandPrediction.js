// src/utils/demandPrediction.js
// 7-Day Crop Demand Forecasting Engine for PRAGATI Agricultural Marketplace
// Time-windowed velocity forecasting with crop-specific benchmarks, low-data fallback, and backend synchronization.

export const BUYER_ORDERS_STORAGE_KEY = 'sih_buyer_orders'
export const FARMER_LISTINGS_STORAGE_KEY = 'sih_farmer_listings'

export const SUPPORTED_CROPS = ['Wheat', 'Rice', 'Potato', 'Onion', 'Tomato', 'Fruits']

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
}

// Backward-compatibility alias
export const CROP_BASELINE_DEMAND = CROP_7DAY_BASELINE_DEMAND

/**
 * Crop key alias dictionary supporting English and Hindi variants
 */
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
}

const CROP_DISPLAY_NAMES = {
  wheat: 'Wheat',
  rice: 'Rice',
  potato: 'Potato',
  onion: 'Onion',
  tomato: 'Tomato',
  fruits: 'Fruits',
}

/**
 * Safely normalize crop input to standard supported crop key
 */
export function normalizeCropKey(crop) {
  if (!crop || typeof crop !== 'string') return null
  const cleaned = crop.toLowerCase().trim()
  return CROP_ALIASES[cleaned] || null
}

/**
 * Defensively extracts orders from localStorage or passed collection
 */
export function getSafeOrders(passedOrders) {
  if (Array.isArray(passedOrders)) return passedOrders
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = localStorage.getItem(BUYER_ORDERS_STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * Defensively extracts listings from localStorage or passed collection
 */
export function getSafeListings(passedListings) {
  if (Array.isArray(passedListings)) return passedListings
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = localStorage.getItem(FARMER_LISTINGS_STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * Extract numerical valid quantity from an order
 */
function extractQuantityKg(order) {
  if (!order || typeof order !== 'object') return 0
  const qty = typeof order.quantityKg === 'number'
    ? order.quantityKg
    : typeof order.quantity === 'number'
      ? order.quantity
      : parseFloat(order.quantityKg || order.quantity || 0)
  return !isNaN(qty) && qty > 0 ? qty : 0
}

/**
 * Generates transparent bilingual explanation based on data source and trend
 */
function buildExplanation({ cropName, predictedDemand, dataSource, trendPercent, lang = 'en', orderCount = 0 }) {
  const isHi = lang === 'hi'

  if (dataSource === 'baseline_estimate') {
    return isHi
      ? `क्षेत्रीय मंडी खपत के आधार पर अगले 7 दिनों के लिए ${cropName} की अनुमानित मांग ${predictedDemand.toLocaleString()} kg है (आधारभूत अनुमान)।`
      : `Projected 7-day demand is ${predictedDemand.toLocaleString()} kg based on regional mandi consumption benchmarks (baseline estimate).`
  }

  if (dataSource === 'limited_marketplace_data') {
    return isHi
      ? `प्रारंभिक ${orderCount} ऑर्डरों और मंडी आधारभूत रुझानों के आधार पर अगले 7 दिनों में मांग ~${predictedDemand.toLocaleString()} kg अनुमानित है।`
      : `Demand is estimated at ~${predictedDemand.toLocaleString()} kg for the next 7 days combining ${orderCount} early platform order(s) with regional benchmarks.`
  }

  if (trendPercent >= 15) {
    return isHi
      ? `हाल के ऑर्डरों में मांग तेजी से बढ़ रही है (+${trendPercent}%)। अगले 7 दिनों में ${predictedDemand.toLocaleString()} kg की अपेक्षित बिक्री है।`
      : `Demand is trending strongly upward (+${trendPercent}%) across confirmed marketplace orders. Projected 7-day volume: ${predictedDemand.toLocaleString()} kg.`
  }

  if (trendPercent <= -15) {
    return isHi
      ? `हाल के ऑर्डरों में मांग में गिरावट (${trendPercent}%) देखी गई है। अगले 7 दिनों की अनुमानित मांग ${predictedDemand.toLocaleString()} kg है।`
      : `Order momentum has softened (${trendPercent}%). Projected 7-day marketplace demand: ${predictedDemand.toLocaleString()} kg.`
  }

  return isHi
    ? `नियमित खरीदार ऑर्डरों के आधार पर अगले 7 दिनों में मांग स्थिर (${predictedDemand.toLocaleString()} kg) बनी हुई है।`
    : `Market demand is steady based on regular confirmed orders. Projected 7-day volume: ${predictedDemand.toLocaleString()} kg.`
}

/**
 * Generates actionable recommendation for farmers and buyers
 */
function buildRecommendation(demandLevel, lang = 'en') {
  const isHi = lang === 'hi'

  if (demandLevel === 'HIGH') {
    return isHi
      ? 'उच्च मांग — उपज सूचीबद्ध करने और प्रतिस्पर्धी लाभ लेने का यह सर्वोत्तम समय है।'
      : 'High demand — favorable market window to list produce at premium rates.'
  }

  if (demandLevel === 'MEDIUM') {
    return isHi
      ? 'मध्यम मांग — नियमित बिक्री के लिए प्रतिस्पर्धी बाजार मूल्य पर सूचीबद्ध करें।'
      : 'Moderate demand — list harvest with competitive pricing for steady turnaround.'
  }

  return isHi
    ? 'कम मांग — तत्काल बिक्री के लिए स्थानीय हब एकत्रीकरण या थोक सौदे पर विचार करें।'
    : 'Lower demand — consider local hub aggregation or flexible pricing for faster clearance.'
}

/**
 * Forecasts 7-day demand for a specific crop deterministically
 */
export function predictCropDemand({ crop, orders, listings, lang = 'en' } = {}) {
  const cropKey = normalizeCropKey(crop)

  if (!cropKey) {
    const isHi = lang === 'hi'
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
      averageDemandKg: 0,
      recentDemandKg: 0,
    }
  }

  const cropName = CROP_DISPLAY_NAMES[cropKey]
  const baseline7d = CROP_7DAY_BASELINE_DEMAND[cropKey] || 500

  const allOrders = getSafeOrders(orders)
  const allListings = getSafeListings(listings)

  // Filter orders matching the crop
  const cropOrders = allOrders.filter((order) => {
    if (!order) return false
    const orderCrop = normalizeCropKey(order.crop || order.cropName || order.listing?.crop)
    return orderCrop === cropKey
  })

  // Filter active listings matching the crop
  const cropListings = allListings.filter((item) => {
    if (!item) return false
    const itemCrop = normalizeCropKey(item.crop)
    return itemCrop === cropKey
  })

  const orderCount = cropOrders.length

  // --------------------------------------------------------------------------
  // SCENARIO 1: ZERO ORDERS (Low-Data Fallback to Crop-Specific Baseline)
  // --------------------------------------------------------------------------
  if (orderCount === 0) {
    const listingSupplyKg = cropListings.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0)
    // Honest confidence: 30% default; 35% if listings present
    const confidence = listingSupplyKg > 0 ? 35 : 30

    return {
      crop: cropName,
      cropKey,
      predictedDemand: baseline7d,
      predictedDemandKg: baseline7d,
      unit: 'kg',
      horizon: '7_days',
      demandLevel: 'MEDIUM', // Realistic baseline represents expected benchmark
      confidence,
      hasEnoughData: false,
      listingSupplyKg: Math.round(listingSupplyKg),
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
      averageDemandKg: 0,
      recentDemandKg: 0,
    }
  }

  // Calculate chronological orders
  const chronologicalOrders = [...cropOrders].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return timeA - timeB
  })

  const quantities = chronologicalOrders
    .map(extractQuantityKg)
    .filter((q) => q > 0)

  const validN = quantities.length
  const totalHistoricalVolumeKg = Math.round(quantities.reduce((sum, q) => sum + q, 0))

  if (validN === 0) {
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
      averageDemandKg: 0,
      recentDemandKg: 0,
    }
  }

  // --------------------------------------------------------------------------
  // SCENARIO 2 & 3: TIME-WINDOWED VELOCITY & PROJECTION
  // --------------------------------------------------------------------------
  const firstTime = chronologicalOrders[0]?.createdAt ? new Date(chronologicalOrders[0].createdAt).getTime() : Date.now()
  const lastTime = chronologicalOrders[chronologicalOrders.length - 1]?.createdAt
    ? new Date(chronologicalOrders[chronologicalOrders.length - 1].createdAt).getTime()
    : Date.now()

  const elapsedMs = Math.max(0, lastTime - firstTime)
  const elapsedDays = Math.max(1, Math.min(30, elapsedMs / (1000 * 60 * 60 * 24)))

  const dailyVelocity = totalHistoricalVolumeKg / elapsedDays
  const raw7dVelocityDemand = dailyVelocity * 7

  let trendPercent = 0
  let trendMultiplier = 1.0

  if (validN >= 3) {
    const half = Math.floor(validN / 2)
    const pastSlice = quantities.slice(0, half)
    const recentSlice = quantities.slice(half)

    const pastSum = pastSlice.reduce((s, q) => s + q, 0)
    const recentSum = recentSlice.reduce((s, q) => s + q, 0)

    const pastAvg = pastSlice.length > 0 ? pastSum / pastSlice.length : 1
    const recentAvg = recentSlice.length > 0 ? recentSum / recentSlice.length : 1

    if (pastAvg > 0) {
      const rawTrend = Math.round(((recentAvg - pastAvg) / pastAvg) * 100)
      trendPercent = Math.max(-80, Math.min(150, rawTrend))
      trendMultiplier = Math.max(0.70, Math.min(1.40, 1 + (trendPercent / 100)))
    }
  }

  const orderDrivenDemand7d = raw7dVelocityDemand * trendMultiplier

  // Bayesian blending with crop baseline
  const dataWeight = Math.min(1.0, validN / 6)
  const blendedPredictedDemand = Math.round((dataWeight * orderDrivenDemand7d) + ((1 - dataWeight) * baseline7d))
  const finalPredictedDemand = Math.max(50, blendedPredictedDemand)

  // Crop-specific normalization against benchmark
  const ratio = baseline7d > 0 ? finalPredictedDemand / baseline7d : 1.0

  let demandLevel = 'MEDIUM'
  if (ratio >= 1.15) {
    demandLevel = 'HIGH'
  } else if (ratio < 0.75) {
    demandLevel = 'LOW'
  }

  // Honest confidence scoring
  let confidence = 45
  let dataSource = 'limited_marketplace_data'

  if (validN >= 6) {
    confidence = Math.min(85, 75 + Math.min(10, Math.floor((validN - 6) * 1.5)))
    dataSource = 'marketplace_orders'
  } else if (validN >= 3) {
    confidence = 60 + (validN * 2)
    dataSource = 'marketplace_orders'
  } else {
    confidence = 45 + (validN * 5)
    dataSource = 'limited_marketplace_data'
  }

  const averageDemandKg = Math.round((totalHistoricalVolumeKg / validN) * 10) / 10
  const recentDemandKg = Math.round(quantities[quantities.length - 1] || 0)

  return {
    crop: cropName,
    cropKey,
    predictedDemand: finalPredictedDemand,
    predictedDemandKg: finalPredictedDemand,
    unit: 'kg',
    horizon: '7_days',
    demandLevel,
    confidence,
    hasEnoughData: validN >= 2,
    explanation: buildExplanation({
      cropName,
      predictedDemand: finalPredictedDemand,
      dataSource,
      trendPercent,
      lang,
      orderCount: validN,
    }),
    recommendation: buildRecommendation(demandLevel, lang),
    dataSource,
    benchmarkKg: baseline7d,
    trendPercent,
    orderCount: validN,
    historicalDemandKg: totalHistoricalVolumeKg,
    averageDemandKg: Math.round(averageDemandKg),
    recentDemandKg,
  }
}

export const calculate7DayDemand = predictCropDemand

/**
 * Forecasts demand across all 6 supported crops
 */
export function predictAllCropsDemand({ orders, listings, lang = 'en' } = {}) {
  return SUPPORTED_CROPS.map((cropName) =>
    predictCropDemand({ crop: cropName, orders, listings, lang })
  )
}

/**
 * Returns top demanded crops sorted by demand level and predicted volume
 */
export function getTopDemandedCrops(limit = 3, options = {}) {
  const all = predictAllCropsDemand(options)
  const priorityScore = { HIGH: 3000, MEDIUM: 2000, LOW: 1000 }

  const sorted = [...all].sort((a, b) => {
    const scoreA = (priorityScore[a.demandLevel] || 0) + (a.predictedDemand || a.predictedDemandKg || 0)
    const scoreB = (priorityScore[b.demandLevel] || 0) + (b.predictedDemand || b.predictedDemandKg || 0)
    return scoreB - scoreA
  })

  return sorted.slice(0, limit)
}

/**
 * Returns consistent UI color styling based on demand level
 */
export function getDemandBadgeStyle(demandLevel) {
  switch (demandLevel) {
    case 'HIGH':
      return {
        bg: '#ecfdf5',
        color: '#065f46',
        border: '#a7f3d0',
        dot: '#059669',
        labelEn: 'High Demand',
        labelHi: 'उच्च मांग',
      }
    case 'MEDIUM':
      return {
        bg: '#eff6ff',
        color: '#1e40af',
        border: '#bfdbfe',
        dot: '#2563eb',
        labelEn: 'Medium Demand',
        labelHi: 'मध्यम मांग',
      }
    case 'LOW':
    default:
      return {
        bg: '#f8fafc',
        color: '#475569',
        border: '#cbd5e1',
        dot: '#64748b',
        labelEn: 'Low Demand',
        labelHi: 'कम मांग',
      }
  }
}

/**
 * Asynchronously fetches demand prediction from backend API with fallback to local calculation
 */
export async function fetchDemandPrediction({ crop, lang = 'en' } = {}) {
  if (typeof window !== 'undefined' && window.fetch) {
    try {
      const url = crop
        ? `/api/demand-prediction?crop=${encodeURIComponent(crop)}&lang=${encodeURIComponent(lang)}`
        : `/api/demand-prediction?lang=${encodeURIComponent(lang)}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        if (data.success) {
          return data
        }
      }
    } catch {
      // Graceful fallback to client calculation
    }
  }
  return predictCropDemand({ crop, lang })
}

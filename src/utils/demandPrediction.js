// src/utils/demandPrediction.js
// Deterministic AI Demand Prediction Engine for SIH 2026 Agricultural Marketplace
// Pure deterministic forecasting utility using marketplace transaction & listing signals

export const BUYER_ORDERS_STORAGE_KEY = 'sih_buyer_orders'
export const FARMER_LISTINGS_STORAGE_KEY = 'sih_farmer_listings'

export const SUPPORTED_CROPS = ['Wheat', 'Rice', 'Potato', 'Onion', 'Tomato', 'Fruits']

/**
 * Predefined baseline consumption demand (in kg) per crop for market normalization
 */
export const CROP_BASELINE_DEMAND = {
  wheat: 500,
  rice: 400,
  potato: 300,
  onion: 250,
  tomato: 150,
  fruits: 150,
}

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
 * Generates transparent bilingual explanation based on trend and market signals
 */
function buildExplanation(trendPercent, orderCount, lang = 'en') {
  const isHi = lang === 'hi'

  if (orderCount === 0) {
    return isHi
      ? 'मांग का पूर्वानुमान लगाने के लिए पर्याप्त लेन-देन डेटा अभी उपलब्ध नहीं है।'
      : 'Not enough transaction data yet to forecast demand.'
  }

  if (orderCount === 1) {
    return isHi
      ? 'प्रारंभिक एकल लेन-देन का पता चला; अधिक ऑर्डरों के साथ विश्वास बढ़ेगा।'
      : 'Early single transaction detected; confidence will grow with more orders.'
  }

  if (trendPercent >= 20) {
    return isHi
      ? 'हाल के खरीदार ऑर्डरों के आधार पर मांग +' + trendPercent + '% तेजी से बढ़ रही है।'
      : 'Demand is increasing rapidly (+' + trendPercent + '%) based on recent buyer orders.'
  }

  if (trendPercent > 5) {
    return isHi
      ? 'हाल के ऑर्डरों में मांग लगातार बढ़ रही है (+' + trendPercent + '%)।'
      : 'Demand is steadily growing (+' + trendPercent + '%) across recent buyer orders.'
  }

  if (trendPercent >= -5) {
    return isHi
      ? 'मांग स्थिर है और खरीदारों का रुझान नियमित बना हुआ है।'
      : 'Demand is stable with consistent buyer purchasing patterns.'
  }

  if (trendPercent >= -20) {
    return isHi
      ? 'हाल के लेन-देन में मांग में मामूली गिरावट (' + trendPercent + '%) देखी गई है।'
      : 'Demand is slightly easing (' + trendPercent + '%) in recent transactions.'
  }

  return isHi
    ? 'पहले के ऑर्डरों की तुलना में मांग धीमी (' + trendPercent + '%) हो गई है।'
    : 'Demand has slowed down (' + trendPercent + '%) compared to earlier orders.'
}

/**
 * Generates actionable recommendation for farmers and buyers
 */
function buildRecommendation(demandLevel, hasEnoughData, lang = 'en') {
  const isHi = lang === 'hi'

  if (!hasEnoughData) {
    return isHi
      ? 'शुरुआती खरीदार रुचि जानने के लिए अपनी उपज सूचीबद्ध करें।'
      : 'List your produce to test early buyer interest.'
  }

  if (demandLevel === 'HIGH') {
    return isHi
      ? 'उच्च मांग — यह अपनी फसल सूचीबद्ध करने का सही समय है।'
      : 'High demand — this may be a good time to list this crop.'
  }

  if (demandLevel === 'MEDIUM') {
    return isHi
      ? 'मध्यम मांग — सूची बनाने से पहले प्रतिस्पर्धी मूल्यों की जांच करें।'
      : 'Moderate demand — check competitive pricing before listing.'
  }

  return isHi
    ? 'कम मांग — सूची बनाने से पहले कीमत की समीक्षा करें या हब एकत्रीकरण चुनें।'
    : 'Low demand — consider checking price before listing.'
}

/**
 * Forecasts demand for a specific crop deterministically
 */
export function predictCropDemand({ crop, orders, listings, lang = 'en' } = {}) {
  const cropKey = normalizeCropKey(crop)

  if (!cropKey) {
    const isHi = lang === 'hi'
    return {
      crop: crop || 'Unknown',
      cropKey: 'unknown',
      historicalDemandKg: 0,
      averageDemandKg: 0,
      recentDemandKg: 0,
      predictedDemandKg: 0,
      trendPercent: 0,
      demandLevel: 'LOW',
      confidence: 0,
      hasEnoughData: false,
      explanation: isHi ? 'अमान्य या असमर्थित फसल।' : 'Invalid or unsupported crop.',
      recommendation: isHi ? 'कृपया एक समर्थित फसल का चयन करें।' : 'Please select a supported crop.',
    }
  }

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

  const N = cropOrders.length
  const baselineReference = CROP_BASELINE_DEMAND[cropKey] || 150

  // 1. Case: Zero historical orders
  if (N === 0) {
    const listingSupplyKg = cropListings.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0)
    const confidence = cropListings.length > 0 ? 35 : 25

    return {
      crop: CROP_DISPLAY_NAMES[cropKey],
      cropKey,
      historicalDemandKg: 0,
      averageDemandKg: 0,
      recentDemandKg: 0,
      predictedDemandKg: 0,
      trendPercent: 0,
      demandLevel: 'LOW',
      confidence,
      hasEnoughData: false,
      listingSupplyKg: Math.round(listingSupplyKg),
      explanation: buildExplanation(0, 0, lang),
      recommendation: buildRecommendation('LOW', false, lang),
    }
  }

  // Calculate order quantities sorted chronologically
  const chronologicalOrders = [...cropOrders].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return timeA - timeB
  })

  const quantities = chronologicalOrders
    .map(extractQuantityKg)
    .filter((q) => q > 0)

  const validN = quantities.length

  if (validN === 0) {
    return {
      crop: CROP_DISPLAY_NAMES[cropKey],
      cropKey,
      historicalDemandKg: 0,
      averageDemandKg: 0,
      recentDemandKg: 0,
      predictedDemandKg: 0,
      trendPercent: 0,
      demandLevel: 'LOW',
      confidence: 25,
      hasEnoughData: false,
      explanation: buildExplanation(0, 0, lang),
      recommendation: buildRecommendation('LOW', false, lang),
    }
  }

  const historicalDemandKg = Math.round(quantities.reduce((sum, q) => sum + q, 0))
  const averageDemandKg = Math.round((historicalDemandKg / validN) * 10) / 10

  // 2. Case: Single historical order
  if (validN === 1) {
    const singleQty = quantities[0]
    const predictedDemandKg = Math.round(singleQty)
    const ratio = baselineReference > 0 ? (predictedDemandKg / baselineReference) : 1.0

    let demandLevel = 'MEDIUM'
    if (ratio >= 1.5) demandLevel = 'HIGH'
    else if (ratio < 0.8) demandLevel = 'LOW'

    return {
      crop: CROP_DISPLAY_NAMES[cropKey],
      cropKey,
      historicalDemandKg,
      averageDemandKg,
      recentDemandKg: Math.round(singleQty),
      predictedDemandKg,
      trendPercent: 0,
      demandLevel,
      confidence: 50,
      hasEnoughData: false,
      explanation: buildExplanation(0, 1, lang),
      recommendation: buildRecommendation(demandLevel, false, lang),
    }
  }

  // 3. Case: Multiple historical orders (N >= 2) -> Full trend & weighted forecast
  const recentCount = Math.max(1, Math.floor(validN / 2))
  const pastCount = validN - recentCount

  const pastSlice = quantities.slice(0, pastCount)
  const recentSlice = quantities.slice(pastCount)

  const pastSum = pastSlice.reduce((sum, q) => sum + q, 0)
  const recentSum = recentSlice.reduce((sum, q) => sum + q, 0)

  const pastAvg = pastCount > 0 ? pastSum / pastCount : pastSum
  const recentAvg = recentCount > 0 ? recentSum / recentCount : recentSum

  let rawTrendPercent = 0
  if (pastAvg > 0) {
    rawTrendPercent = Math.round(((recentAvg - pastAvg) / pastAvg) * 100)
  }
  const trendPercent = Math.max(-80, Math.min(150, rawTrendPercent))

  const trendMultiplier = 1 + (trendPercent / 100)
  const rawPredicted = (0.7 * recentAvg) + (0.3 * averageDemandKg * trendMultiplier)
  const predictedDemandKg = Math.max(0, Math.round(rawPredicted))

  // Determine demand level against baseline (average order volume or crop baseline)
  const baseline = averageDemandKg > 0 ? averageDemandKg : baselineReference
  const ratio = baseline > 0 ? (predictedDemandKg / baseline) : 1.0

  let demandLevel = 'MEDIUM'
  if (ratio >= 1.5) {
    demandLevel = 'HIGH'
  } else if (ratio < 0.8) {
    demandLevel = 'LOW'
  }

  let confidence = 65
  if (validN >= 5) {
    confidence = Math.min(92, 80 + (validN * 2))
  } else if (validN >= 3) {
    confidence = 75 + (validN * 2)
  } else {
    confidence = 68
  }

  return {
    crop: CROP_DISPLAY_NAMES[cropKey],
    cropKey,
    historicalDemandKg,
    averageDemandKg: Math.round(averageDemandKg),
    recentDemandKg: Math.round(recentAvg),
    predictedDemandKg,
    trendPercent,
    demandLevel,
    confidence,
    hasEnoughData: true,
    explanation: buildExplanation(trendPercent, validN, lang),
    recommendation: buildRecommendation(demandLevel, true, lang),
  }
}

/**
 * Forecasts demand across all 6 supported crops
 */
export function predictAllCropsDemand({ orders, listings, lang = 'en' } = {}) {
  return SUPPORTED_CROPS.map((cropName) =>
    predictCropDemand({ crop: cropName, orders, listings, lang })
  )
}

/**
 * Returns top demanded crops sorted by predicted volume and demand level
 */
export function getTopDemandedCrops(limit = 3, options = {}) {
  const all = predictAllCropsDemand(options)

  const priorityScore = { HIGH: 3000, MEDIUM: 2000, LOW: 1000 }

  const sorted = [...all].sort((a, b) => {
    const scoreA = (priorityScore[a.demandLevel] || 0) + a.predictedDemandKg
    const scoreB = (priorityScore[b.demandLevel] || 0) + b.predictedDemandKg
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

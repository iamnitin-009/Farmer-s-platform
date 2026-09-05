// src/utils/buyerMatching.js
// Deterministic Buyer Matching & Ranking Engine for SIH 2026

import { getAllOrders } from './auth.js'

/**
 * Normalizes a location string into searchable tokens (city, district, state).
 * @param {string} loc
 * @returns {string[]}
 */
export function normalizeLocationTokens(loc) {
  if (!loc || typeof loc !== 'string') return []
  return loc
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_~()]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
}

/**
 * Deterministic MVP Location Proximity Scorer.
 * Evaluates proximity based on matching city/district or state tokens.
 *
 * @param {string} farmerLoc
 * @param {string} buyerLoc
 * @returns {{ score: number, labelEn: string, labelHi: string, tier: 'local'|'regional'|'interstate'|'unknown' }}
 */
export function calculateLocationProximity(farmerLoc, buyerLoc) {
  const fTokens = normalizeLocationTokens(farmerLoc)
  const bTokens = normalizeLocationTokens(buyerLoc)

  if (fTokens.length === 0 || bTokens.length === 0) {
    return {
      score: 8,
      labelEn: 'Location estimate pending',
      labelHi: 'स्थान अनुमान प्रतीक्षित',
      tier: 'unknown',
    }
  }

  // Check exact token overlap (e.g. "nashik", "delhi", "karnal")
  const commonTokens = fTokens.filter((t) => bTokens.includes(t))

  // State-level common tokens in India
  const stateKeywords = [
    'maharashtra', 'haryana', 'punjab', 'rajasthan', 'gujarat',
    'karnataka', 'tamil', 'nadu', 'kerala', 'uttar', 'pradesh',
    'madhya', 'bihar', 'bengal', 'odisha', 'andhra', 'telangana', 'delhi'
  ]

  const isStateMatch = commonTokens.some((t) => stateKeywords.includes(t))
  const isCityMatch = commonTokens.some((t) => !stateKeywords.includes(t))

  if (isCityMatch) {
    return {
      score: 15,
      labelEn: 'Local (~15–30 km)',
      labelHi: 'स्थानीय (~15–30 किमी)',
      tier: 'local',
    }
  }

  if (isStateMatch || commonTokens.length > 0) {
    return {
      score: 11,
      labelEn: 'Regional (~80–150 km)',
      labelHi: 'क्षेत्रीय (~80–150 किमी)',
      tier: 'regional',
    }
  }

  // Inter-state transport
  return {
    score: 6,
    labelEn: 'Inter-state transport (~300–600 km)',
    labelHi: 'अंतर-राज्य परिवहन (~300–600 किमी)',
    tier: 'interstate',
  }
}

/**
 * Calculates deterministic Quality Compatibility (5 pts).
 *
 * @param {string|null} farmerGrade - 'A' | 'B' | 'C' | null
 * @param {string|null} buyerGrade - 'A' | 'B' | 'C' | null
 * @returns {{ score: number, reasonEn: string, reasonHi: string }}
 */
export function calculateQualityScore(farmerGrade, buyerGrade) {
  const fGrade = farmerGrade ? String(farmerGrade).toUpperCase().trim() : null
  const bGrade = buyerGrade ? String(buyerGrade).toUpperCase().trim() : null

  // If buyer didn't specify a strict grade, standard harvest accepted
  if (!bGrade) {
    if (fGrade === 'A') {
      return { score: 5, reasonEn: 'Grade A premium quality offered', reasonHi: 'ग्रेड A प्रीमियम गुणवत्ता उपलब्ध' }
    }
    if (fGrade === 'B') {
      return { score: 5, reasonEn: 'Grade B commercial quality offered', reasonHi: 'ग्रेड B व्यावसायिक गुणवत्ता उपलब्ध' }
    }
    return { score: 4, reasonEn: 'Standard quality harvest', reasonHi: 'मानक गुणवत्ता उपज' }
  }

  if (fGrade === bGrade) {
    return { score: 5, reasonEn: `Exact Grade ${fGrade} match`, reasonHi: `सटीक ग्रेड ${fGrade} मिलान` }
  }

  // Farmer grade exceeds buyer requirement
  if (fGrade === 'A' && (bGrade === 'B' || bGrade === 'C')) {
    return { score: 5, reasonEn: 'Grade A exceeds buyer requirement', reasonHi: 'ग्रेड A खरीदार की मांग से बेहतर' }
  }
  if (fGrade === 'B' && bGrade === 'C') {
    return { score: 5, reasonEn: 'Grade B exceeds buyer requirement', reasonHi: 'ग्रेड B खरीदार की मांग से बेहतर' }
  }

  // Farmer grade is lower than requested
  if (fGrade === 'B' && bGrade === 'A') {
    return { score: 3, reasonEn: 'Grade B acceptable alternative for Grade A', reasonHi: 'ग्रेड A के लिए ग्रेड B स्वीकार्य विकल्प' }
  }
  if (fGrade === 'C' && bGrade === 'A') {
    return { score: 1, reasonEn: 'Grade C below requested Grade A', reasonHi: 'ग्रेड C मांगी गई ग्रेड A से कम' }
  }

  return { score: 3, reasonEn: 'General harvest quality', reasonHi: 'सामान्य उपज गुणवत्ता' }
}

/**
 * Calculates Quantity Compatibility Score (25 pts).
 *
 * @param {number} farmerQty - Available lot quantity in kg
 * @param {number} buyerQty - Desired buyer quantity in kg
 * @returns {{ score: number, reasonEn: string, reasonHi: string }}
 */
export function calculateQuantityScore(farmerQty, buyerQty) {
  const fQ = Number(farmerQty) || 0
  const bQ = Number(buyerQty) || 0

  if (fQ <= 0 || bQ <= 0) {
    return { score: 10, reasonEn: 'Quantity compatibility pending', reasonHi: 'मात्रा अनुकूलता प्रतीक्षित' }
  }

  // Case 1: Buyer wants less than or equal to farmer's lot (full fulfillment)
  if (bQ <= fQ) {
    const ratio = bQ / fQ
    if (ratio >= 0.5) {
      return {
        score: 25,
        reasonEn: `Fulfills buyer lot (${bQ} kg from ${fQ} kg)`,
        reasonHi: `खरीदार की मांग पूर्ण (${fQ} किग्रा में से ${bQ} किग्रा)`,
      }
    }
    // Partial lot (less than 50% of farmer's batch)
    const partialScore = Math.round(15 + 10 * (ratio / 0.5))
    return {
      score: partialScore,
      reasonEn: `Partial batch purchase (${bQ} kg of ${fQ} kg lot)`,
      reasonHi: `आंशिक लॉट खरीद (${fQ} किग्रा में से ${bQ} किग्रा)`,
    }
  }

  // Case 2: Buyer wants more than farmer currently has (farmer covers a major share)
  const coverageRatio = fQ / bQ
  if (coverageRatio >= 0.7) {
    return {
      score: 20,
      reasonEn: `Supplies ${Math.round(coverageRatio * 100)}% of buyer demand (${fQ} / ${bQ} kg)`,
      reasonHi: `खरीदार की ${Math.round(coverageRatio * 100)}% मांग की पूर्ति (${fQ} / ${bQ} किग्रा)`,
    }
  }
  if (coverageRatio >= 0.3) {
    return {
      score: 15,
      reasonEn: `Supplies ${Math.round(coverageRatio * 100)}% of buyer demand (${fQ} / ${bQ} kg)`,
      reasonHi: `खरीदार की ${Math.round(coverageRatio * 100)}% मांग की पूर्ति (${fQ} / ${bQ} किग्रा)`,
    }
  }
  return {
    score: 10,
    reasonEn: `Supplies small share (${fQ} kg towards ${bQ} kg requirement)`,
    reasonHi: `छोटी आपूर्ति (${bQ} किग्रा की मांग के लिए ${fQ} किग्रा)`,
  }
}

/**
 * Calculates Price Compatibility Score (20 pts).
 *
 * @param {number} farmerPrice - Farmer's asking price in ₹/kg
 * @param {number} buyerPrice - Buyer's offered / historical price in ₹/kg
 * @returns {{ score: number, reasonEn: string, reasonHi: string }}
 */
export function calculatePriceScore(farmerPrice, buyerPrice) {
  const fP = Number(farmerPrice) || 0
  const bP = Number(buyerPrice) || 0

  if (fP <= 0 || bP <= 0) {
    return { score: 10, reasonEn: 'Market rate subject to negotiation', reasonHi: 'दर पर बातचीत संभव' }
  }

  if (bP >= fP) {
    return {
      score: 20,
      reasonEn: `Offered rate (₹${bP}/kg) meets or exceeds asking (₹${fP}/kg)`,
      reasonHi: `प्रस्तावित दर (₹${bP}/किग्रा) किसान दर (₹${fP}/किग्रा) के बराबर या अधिक`,
    }
  }

  const ratio = bP / fP
  if (ratio >= 0.95) {
    return {
      score: 18,
      reasonEn: `Offered rate (₹${bP}/kg) is within 5% of asking (₹${fP}/kg)`,
      reasonHi: `प्रस्तावित दर (₹${bP}/किग्रा) किसान दर के अत्यंत निकट (5% के भीतर)`,
    }
  }
  if (ratio >= 0.90) {
    return {
      score: 15,
      reasonEn: `Offered rate (₹${bP}/kg) is within 10% of asking (₹${fP}/kg)`,
      reasonHi: `प्रस्तावित दर (₹${bP}/किग्रा) किसान दर के 10% के भीतर`,
    }
  }
  if (ratio >= 0.80) {
    return {
      score: 11,
      reasonEn: `Offered rate (₹${bP}/kg) is within 20% of asking (₹${fP}/kg)`,
      reasonHi: `प्रस्तावित दर (₹${bP}/किग्रा) किसान दर के 20% के भीतर`,
    }
  }
  if (ratio >= 0.70) {
    return {
      score: 7,
      reasonEn: `Offered rate (₹${bP}/kg) is lower than asking (₹${fP}/kg)`,
      reasonHi: `प्रस्तावित दर (₹${bP}/किग्रा) किसान दर से कम`,
    }
  }
  return {
    score: 3,
    reasonEn: `Significant price gap: ₹${bP}/kg offered vs ₹${fP}/kg asking`,
    reasonHi: `दर में बड़ा अंतर: ₹${bP} प्रस्तावित बनाम ₹${fP} मांग`,
  }
}

/**
 * Computes deterministic match score (0-100) between a farmer listing and a buyer demand order.
 *
 * @param {Object} listing - Farmer produce listing
 * @param {Object} demand - Buyer order / demand record
 * @returns {{
 *   matchScore: number,
 *   eligible: boolean,
 *   breakdown: { crop: number, quantity: number, price: number, location: number, quality: number },
 *   reasonsEn: string[],
 *   reasonsHi: string[],
 *   distanceEstimateEn: string,
 *   distanceEstimateHi: string,
 * }}
 */
export function calculateBuyerMatchScore(listing, demand) {
  if (!listing || !demand) {
    return { matchScore: 0, eligible: false, breakdown: {}, reasonsEn: [], reasonsHi: [] }
  }

  const listingCrop = (listing.crop || '').toLowerCase().trim()
  const demandCrop = (demand.crop || '').toLowerCase().trim()

  // 1. Mandatory Crop Match (35 pts)
  if (!listingCrop || !demandCrop || listingCrop !== demandCrop) {
    return {
      matchScore: 0,
      eligible: false,
      breakdown: { crop: 0, quantity: 0, price: 0, location: 0, quality: 0 },
      reasonsEn: ['Crop does not match'],
      reasonsHi: ['फसल मेल नहीं खाती'],
      distanceEstimateEn: '',
      distanceEstimateHi: '',
    }
  }
  const cropScore = 35

  // 2. Quantity Compatibility (25 pts)
  const qtyResult = calculateQuantityScore(listing.quantity, demand.quantity)

  // 3. Price Compatibility (20 pts)
  const farmerPrice = listing.price ?? listing.expectedPrice ?? listing.fairPrice?.suggestedPrice ?? 0
  const buyerPrice = demand.pricePerKg ?? demand.offeredPrice ?? demand.price ?? 0
  const priceResult = calculatePriceScore(farmerPrice, buyerPrice)

  // 4. Location Proximity (15 pts)
  const farmerLoc = listing.location || ''
  const buyerLoc = demand.buyerLocation || demand.location || ''
  const locResult = calculateLocationProximity(farmerLoc, buyerLoc)

  // 5. Quality Compatibility (5 pts)
  const farmerGrade = listing.quality?.grade ?? listing.grade ?? null
  const buyerGrade = demand.preferredGrade ?? demand.grade ?? null
  const qualityResult = calculateQualityScore(farmerGrade, buyerGrade)

  const totalScore = Math.min(100, Math.round(
    cropScore + qtyResult.score + priceResult.score + locResult.score + qualityResult.score
  ))

  const reasonsEn = [
    `Crop matched: ${listingCrop.charAt(0).toUpperCase() + listingCrop.slice(1)}`,
    qtyResult.reasonEn,
    priceResult.reasonEn,
    `Location: ${buyerLoc || 'Region'} (${locResult.labelEn})`,
    qualityResult.reasonEn,
  ]

  const reasonsHi = [
    `फसल सुसंगत: ${listingCrop}`,
    qtyResult.reasonHi,
    priceResult.reasonHi,
    `स्थान: ${buyerLoc || 'क्षेत्र'} (${locResult.labelHi})`,
    qualityResult.reasonHi,
  ]

  return {
    matchScore: totalScore,
    eligible: true,
    breakdown: {
      crop: cropScore,
      quantity: qtyResult.score,
      price: priceResult.score,
      location: locResult.score,
      quality: qualityResult.score,
    },
    reasonsEn,
    reasonsHi,
    distanceEstimateEn: locResult.labelEn,
    distanceEstimateHi: locResult.labelHi,
  }
}

/**
 * Finds and ranks buyer demand matches for a given farmer listing.
 * Sourced from verified marketplace orders.
 *
 * @param {Object} params
 * @param {Object} params.listing - Farmer listing
 * @param {Array} [params.orders] - Optional orders array (defaults to getAllOrders())
 * @param {string} [params.currentUserId] - Optional farmer ID to filter out self-orders
 * @param {string} [params.lang='en'] - Output language
 * @returns {Array<{
 *   id: string,
 *   buyerId: string,
 *   buyerName: string,
 *   buyerMobile: string,
 *   buyerLocation: string,
 *   quantity: number,
 *   offeredPrice: number,
 *   matchScore: number,
 *   distanceEstimate: string,
 *   reasons: string[],
 *   date: string,
 * }>} Ranked array of buyer matches, sorted descending by matchScore
 */
export function findBuyerMatches({
  listing,
  orders = null,
  currentUserId = null,
  lang = 'en',
} = {}) {
  if (!listing || !listing.crop) return []

  const allOrders = orders !== null ? orders : getAllOrders()
  if (!Array.isArray(allOrders) || allOrders.length === 0) return []

  // Clean buyer demand records
  const matches = []

  for (const order of allOrders) {
    // Exclude farmer's own buy orders to ensure genuine independent demand
    if (currentUserId && (order.buyerId === currentUserId || order.buyerMobile === listing.farmerMobile)) {
      continue
    }

    const matchAnalysis = calculateBuyerMatchScore(listing, order)
    if (!matchAnalysis.eligible || matchAnalysis.matchScore <= 0) {
      continue
    }

    matches.push({
      id: order.id || 'demand_' + Math.random().toString(36).substring(2, 8),
      buyerId: order.buyerId || 'buyer_anon',
      buyerName: order.buyerName || 'Verified Buyer',
      buyerMobile: order.buyerMobile ? maskMobile(order.buyerMobile) : '+91 ••••• •••••',
      rawMobile: order.buyerMobile || '',
      buyerLocation: order.buyerLocation || order.location || 'Local Market',
      crop: order.crop,
      quantity: order.quantity || 0,
      offeredPrice: order.pricePerKg ?? order.offeredPrice ?? 0,
      matchScore: matchAnalysis.matchScore,
      distanceEstimate: lang === 'hi' ? matchAnalysis.distanceEstimateHi : matchAnalysis.distanceEstimateEn,
      reasons: lang === 'hi' ? matchAnalysis.reasonsHi : matchAnalysis.reasonsEn,
      breakdown: matchAnalysis.breakdown,
      date: order.createdAt || new Date().toISOString(),
    })
  }

  // Sort descending by matchScore, then by newest date
  matches.sort((a, b) => {
    if (b.matchScore !== a.matchScore) {
      return b.matchScore - a.matchScore
    }
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })

  return matches
}

/**
 * Mask mobile for privacy in presentation (e.g. 9876543210 -> +91 98****3210).
 */
function maskMobile(mobile) {
  if (!mobile || typeof mobile !== 'string') return '+91 ••••• •••••'
  const cleaned = mobile.trim()
  if (cleaned.length < 10) return cleaned
  return `+91 ${cleaned.slice(0, 2)}****${cleaned.slice(-4)}`
}

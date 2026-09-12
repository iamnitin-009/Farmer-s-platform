// src/utils/buyerMatching.js
// BFM-001: Buyer–Farmer Matching & Multi-Farmer Order Allocation Engine
// Deterministic 3-stage pipeline: Hard Eligibility Filters -> Scoring & Ranking -> Greedy Allocation

import { getAllOrders } from './auth.js'
import {
  CROP_BASE_PRICES,
  normalizeCropKey,
  normalizeVariety,
  getCropVarieties,
} from './cropConstants.js'
import { calculateDeliveryPricing } from './deliveryPricing.js'

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
 * Deterministic Location Proximity & Estimated Distance Calculator.
 * @param {string} farmerLoc
 * @param {string} buyerLoc
 * @returns {{ score: number, distanceKm: number, labelEn: string, labelHi: string, tier: 'local'|'regional'|'interstate'|'unknown' }}
 */
export function calculateLocationProximity(farmerLoc, buyerLoc) {
  const fTokens = normalizeLocationTokens(farmerLoc)
  const bTokens = normalizeLocationTokens(buyerLoc)

  if (fTokens.length === 0 || bTokens.length === 0) {
    return {
      score: 12,
      distanceKm: 150,
      labelEn: 'Location estimate pending (~150 km)',
      labelHi: 'स्थान अनुमान प्रतीक्षित (~150 किमी)',
      tier: 'unknown',
    }
  }

  const commonTokens = fTokens.filter((t) => bTokens.includes(t))

  const stateKeywords = [
    'maharashtra', 'haryana', 'punjab', 'rajasthan', 'gujarat',
    'karnataka', 'tamil', 'nadu', 'kerala', 'uttar', 'pradesh',
    'madhya', 'bihar', 'bengal', 'odisha', 'andhra', 'telangana', 'delhi'
  ]

  const isStateMatch = commonTokens.some((t) => stateKeywords.includes(t))
  const isCityMatch = commonTokens.some((t) => !stateKeywords.includes(t))

  if (isCityMatch) {
    return {
      score: 25,
      distanceKm: 25,
      labelEn: 'Local (~15–30 km)',
      labelHi: 'स्थानीय (~15–30 किमी)',
      tier: 'local',
    }
  }

  if (isStateMatch || commonTokens.length > 0) {
    return {
      score: 18,
      distanceKm: 100,
      labelEn: 'Regional (~80–150 km)',
      labelHi: 'क्षेत्रीय (~80–150 किमी)',
      tier: 'regional',
    }
  }

  return {
    score: 10,
    distanceKm: 450,
    labelEn: 'Inter-state transport (~300–600 km)',
    labelHi: 'अंतर-राज्य परिवहन (~300–600 किमी)',
    tier: 'interstate',
  }
}

/**
 * Grade numeric rank for deterministic comparisons (A=3, B=2, C=1, unassessed=2 default).
 */
export function getGradeRank(grade) {
  if (!grade) return 2 // Commercial default
  const g = String(grade).toUpperCase().trim()
  if (g === 'A') return 3
  if (g === 'B') return 2
  if (g === 'C') return 1
  return 2
}

/**
 * Normalizes buyer requirement criteria.
 */
export function normalizeBuyerRequirement(req = {}) {
  const crop = normalizeCropKey(req.crop || req.product)
  const quantity = Math.max(0, parseFloat(req.quantity) || 0)
  const rawVariety = req.variety ? String(req.variety).trim() : null
  const variety = (!rawVariety || rawVariety.toLowerCase() === 'any' || rawVariety.toLowerCase() === 'all')
    ? null
    : normalizeVariety(crop, rawVariety)

  const minGrade = req.minGrade && ['A', 'B', 'C'].includes(String(req.minGrade).toUpperCase())
    ? String(req.minGrade).toUpperCase()
    : null

  const maxPrice = req.maxPrice ? parseFloat(req.maxPrice) : null
  const maxDistance = req.maxDistance ? parseFloat(req.maxDistance) : null
  const buyerLocation = (req.buyerLocation || req.location || '').trim()

  return {
    crop,
    quantity,
    variety,
    isAnyVariety: !variety,
    minGrade,
    maxPrice: maxPrice && maxPrice > 0 ? maxPrice : null,
    maxDistance: maxDistance && maxDistance > 0 ? maxDistance : null,
    buyerLocation,
    pickupConstraint: req.pickupConstraint || null,
  }
}

/**
 * Stage 1: Hard Eligibility Filters.
 * Evaluates whether a farmer listing is strictly eligible for a buyer requirement.
 * Crop is an eligibility gate, NOT a score contributor.
 *
 * @param {Object} listing - Farmer listing
 * @param {Object} requirement - Normalized buyer requirement
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function checkListingEligibility(listing, requirement) {
  if (!listing || !requirement) {
    return { eligible: false, reason: 'Invalid listing or requirement payload' }
  }

  // Active status check
  if (listing.status === 'Sold Out' || listing.status === 'Sold' || listing.moderationStatus === 'rejected') {
    return { eligible: false, reason: 'Listing is sold out or inactive' }
  }

  // Available quantity check
  const availableQty = Math.max(0, (listing.quantity || 0) - (listing.reservedQuantity || 0))
  if (availableQty <= 0) {
    return { eligible: false, reason: 'No available unreserved inventory' }
  }

  // 1. Mandatory Crop Match Gate
  const listingCrop = normalizeCropKey(listing.crop)
  if (!listingCrop || listingCrop !== requirement.crop) {
    return { eligible: false, reason: `Crop mismatch: requires ${requirement.crop}, listing is ${listing.crop}` }
  }

  // 2. Variety Safety Gate
  if (!requirement.isAnyVariety && requirement.variety) {
    const reqVarNorm = normalizeVariety(requirement.crop, requirement.variety)
    const listVarNorm = normalizeVariety(listing.crop, listing.variety)
    if (!listVarNorm || listVarNorm.toLowerCase() !== reqVarNorm.toLowerCase()) {
      return {
        eligible: false,
        reason: `Variety mismatch: requires ${requirement.variety}, listing is ${listing.variety || 'Unknown'}`,
      }
    }
  }

  // 3. Minimum Grade Gate
  if (requirement.minGrade) {
    const listGrade = listing.quality?.grade || listing.grade || null
    const listRank = getGradeRank(listGrade)
    const reqRank = getGradeRank(requirement.minGrade)
    if (listRank < reqRank) {
      return {
        eligible: false,
        reason: `Grade below requirement: requires Grade ${requirement.minGrade}, listing is Grade ${listGrade || 'C'}`,
      }
    }
  }

  // 4. Maximum Price Gate
  if (requirement.maxPrice !== null) {
    const askingPrice = parseFloat(listing.price ?? listing.expectedPrice ?? 0)
    if (askingPrice > requirement.maxPrice) {
      return {
        eligible: false,
        reason: `Price exceeds ceiling: asking ₹${askingPrice}/kg, max offered ₹${requirement.maxPrice}/kg`,
      }
    }
  }

  // 5. Maximum Distance Gate
  if (requirement.maxDistance !== null) {
    const prox = calculateLocationProximity(listing.location, requirement.buyerLocation)
    if (prox.distanceKm > requirement.maxDistance) {
      return {
        eligible: false,
        reason: `Distance exceeds radius: ~${prox.distanceKm} km vs max ${requirement.maxDistance} km`,
      }
    }
  }

  return { eligible: true }
}

/**
 * Filters all listings against a requirement using Stage 1 Hard Filters.
 */
export function filterEligibleListings(listings, requirement) {
  if (!Array.isArray(listings)) return []
  const normReq = normalizeBuyerRequirement(requirement)
  return listings.filter((l) => checkListingEligibility(l, normReq).eligible)
}

/**
 * Stage 2: Match Scoring (0-100 deterministic, explainable).
 * Factors: Price competitiveness (30), Distance (25), Quantity Fit (25), Quality (12), Logistics (8).
 * Quantity scoring explicitly favors allocations that reduce the number of farmers needed.
 */
export function scoreListingMatch(listing, requirement) {
  const normReq = normalizeBuyerRequirement(requirement)
  const eligCheck = checkListingEligibility(listing, normReq)
  if (!eligCheck.eligible) {
    return {
      matchScore: 0,
      eligible: false,
      reasonsEn: [eligCheck.reason || 'Not eligible'],
      reasonsHi: ['अपात्र सूची'],
      breakdown: { price: 0, distance: 0, quantityFit: 0, quality: 0, logistics: 0 },
    }
  }

  const crop = normReq.crop
  const basePrice = CROP_BASE_PRICES[crop] || 35
  const askingPrice = parseFloat(listing.price ?? listing.expectedPrice ?? basePrice)
  const targetPrice = normReq.maxPrice || basePrice

  // 1. Price Competitiveness (up to 30 pts)
  let priceScore = 20
  if (askingPrice <= targetPrice * 0.9) {
    priceScore = 30
  } else if (askingPrice <= targetPrice) {
    priceScore = 25
  } else {
    const ratio = targetPrice / askingPrice
    priceScore = Math.max(5, Math.round(25 * ratio))
  }

  // 2. Distance / Proximity (up to 25 pts)
  const locResult = calculateLocationProximity(listing.location, normReq.buyerLocation)
  const distanceScore = locResult.score // 25 for local, 18 for regional, 10 for interstate

  // 3. Quantity Fit / Reducing Farmer Count (up to 25 pts)
  const availableQty = Math.max(0, (listing.quantity || 0) - (listing.reservedQuantity || 0))
  const neededQty = normReq.quantity || 1
  let quantityFitScore = 10
  if (availableQty >= neededQty) {
    // Single farmer can fulfill 100% of the order alone!
    quantityFitScore = 25
  } else {
    const coverageRatio = availableQty / neededQty
    if (coverageRatio >= 0.7) {
      quantityFitScore = 22
    } else if (coverageRatio >= 0.4) {
      quantityFitScore = 18
    } else if (coverageRatio >= 0.2) {
      quantityFitScore = 14
    } else {
      quantityFitScore = 10
    }
  }

  // 4. Quality Grade (up to 12 pts)
  const grade = listing.quality?.grade || listing.grade || 'B'
  let qualityScore = 9
  if (grade === 'A') qualityScore = 12
  else if (grade === 'B') qualityScore = 9
  else if (grade === 'C') qualityScore = 5

  // 5. Logistics Compatibility (up to 8 pts)
  let logisticsScore = 6
  if (listing.pickupDecision?.method === 'HOME' && availableQty >= 100) {
    logisticsScore = 8 // Direct bulk farmgate pickup
  } else if (listing.pickupDecision?.method === 'HUB') {
    logisticsScore = 7
  }

  const totalScore = Math.min(100, priceScore + distanceScore + quantityFitScore + qualityScore + logisticsScore)

  const reasonsEn = [
    `Price ₹${askingPrice}/kg (${priceScore}/30 pts)`,
    `${locResult.labelEn} (${distanceScore}/25 pts)`,
    `Supplies ${Math.min(availableQty, neededQty)} kg towards demand (${quantityFitScore}/25 pts)`,
    `Quality Grade ${grade} (${qualityScore}/12 pts)`,
    `Pickup: ${listing.pickupDecision?.method || 'Standard'} (${logisticsScore}/8 pts)`,
  ]

  const reasonsHi = [
    `मूल्य ₹${askingPrice}/किग्रा (${priceScore}/30 अंक)`,
    `${locResult.labelHi} (${distanceScore}/25 अंक)`,
    `मांग के लिए ${Math.min(availableQty, neededQty)} किग्रा आपूर्ति (${quantityFitScore}/25 अंक)`,
    `गुणवत्ता ग्रेड ${grade} (${qualityScore}/12 अंक)`,
    `पिकअप: ${listing.pickupDecision?.method || 'मानक'} (${logisticsScore}/8 अंक)`,
  ]

  return {
    matchScore: totalScore,
    eligible: true,
    breakdown: {
      price: priceScore,
      distance: distanceScore,
      quantityFit: quantityFitScore,
      quality: qualityScore,
      logistics: logisticsScore,
    },
    reasonsEn,
    reasonsHi,
    distanceKm: locResult.distanceKm,
    distanceEstimateEn: locResult.labelEn,
    distanceEstimateHi: locResult.labelHi,
  }
}

/**
 * Stage 3: Greedy Multi-Farmer Allocation Engine.
 * Strategy: SCORE -> SORT -> GREEDY FILL
 *
 * @param {Object} requirement - Buyer order requirement
 * @param {Array<Object>} listings - Available listings
 * @returns {{
 *   requirement: Object,
 *   requestedQuantity: number,
 *   fulfilledQuantity: number,
 *   remainingQuantity: number,
 *   fulfillmentStatus: 'FULFILLED' | 'PARTIAL' | 'UNFULFILLED',
 *   totalAmount: number,
 *   weightedAveragePrice: number,
 *   allocations: Array<Object>,
 *   candidateCount: number,
 *   eligibleCount: number,
 * }}
 */
function allocateSingleVarietyPlan(normReq, candidates = [], totalCandidateCount = candidates.length) {
  if (candidates.length === 0 || normReq.quantity <= 0) {
    return {
      requirement: normReq,
      requestedQuantity: normReq.quantity,
      fulfilledQuantity: 0,
      remainingQuantity: normReq.quantity,
      fulfillmentStatus: 'UNFULFILLED',
      totalAmount: 0,
      weightedAveragePrice: 0,
      allocations: [],
      candidateCount: totalCandidateCount,
      eligibleCount: 0,
    }
  }

  // Score each eligible candidate
  const scored = candidates.map((item) => {
    const analysis = scoreListingMatch(item, normReq)
    const availableQty = Math.max(0, (item.quantity || 0) - (item.reservedQuantity || 0))
    return {
      listing: item,
      availableQuantity: availableQty,
      score: analysis.matchScore,
      breakdown: analysis.breakdown,
      reasonsEn: analysis.reasonsEn,
      reasonsHi: analysis.reasonsHi,
      distanceKm: analysis.distanceKm,
    }
  })

  // Sort descending by score, then largest available lot to minimize farmer count
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.availableQuantity - a.availableQuantity
  })

  let remainingDemand = normReq.quantity
  const allocations = []
  let totalAmount = 0

  for (const candidate of scored) {
    if (remainingDemand <= 0) break
    const { listing, availableQuantity, score, breakdown, reasonsEn, reasonsHi } = candidate
    if (availableQuantity <= 0) continue

    const allocatedQty = Math.min(availableQuantity, remainingDemand)
    const unitPrice = parseFloat(listing.price ?? listing.expectedPrice ?? 0)
    const itemTotal = Math.round(allocatedQty * unitPrice * 100) / 100

    allocations.push({
      allocationId: 'ALC_' + Date.now().toString().slice(-6) + '_' + Math.random().toString(36).substring(2, 6),
      listingId: listing.id,
      farmerId: listing.farmerId || 'farmer_anon',
      farmerName: listing.farmerName || 'Verified Farmer',
      farmerMobile: listing.farmerMobile || '',
      farmerLocation: listing.location || '',
      crop: listing.crop,
      variety: listing.variety || 'Regular',
      grade: listing.quality?.grade || listing.grade || 'B',
      allocatedQuantity: allocatedQty,
      unitPrice,
      agreedPrice: unitPrice,
      totalAmount: itemTotal,
      status: 'PENDING',
      score,
      scoreBreakdown: breakdown,
      reasons: reasonsEn,
      reasonsHi,
      createdAt: new Date().toISOString(),
    })

    totalAmount += itemTotal
    remainingDemand -= allocatedQty
  }

  const fulfilledQuantity = Math.round((normReq.quantity - remainingDemand) * 100) / 100
  const remainingQuantity = Math.max(0, Math.round(remainingDemand * 100) / 100)
  const fulfillmentStatus = remainingQuantity === 0 ? 'FULFILLED' : (fulfilledQuantity > 0 ? 'PARTIAL' : 'UNFULFILLED')
  const weightedAveragePrice = fulfilledQuantity > 0 ? Math.round((totalAmount / fulfilledQuantity) * 100) / 100 : 0
  const productSubtotal = Math.round(totalAmount * 100) / 100

  // DLV-001 delivery pricing calculation
  const dlv = calculateDeliveryPricing(productSubtotal, fulfilledQuantity)

  return {
    requirement: normReq,
    requestedQuantity: normReq.quantity,
    fulfilledQuantity,
    remainingQuantity,
    fulfillmentStatus,
    productSubtotal,
    deliveryCharge: dlv.deliveryCharge,
    platformFee: dlv.platformFee,
    discount: dlv.discount,
    netPayable: dlv.netPayable,
    effectivePricePerKg: dlv.effectivePricePerKg,
    deliveryStatus: dlv.deliveryStatus,
    freeDeliveryEligible: dlv.freeDeliveryEligible,
    amountNeededForFreeDelivery: dlv.amountNeededForFreeDelivery,
    deliveryExplanation: dlv.explanation,
    deliveryRuleVersion: dlv.deliveryRuleVersion,
    totalAmount: dlv.netPayable,
    totalEstimatedCost: productSubtotal,
    weightedAveragePrice,
    allocations,
    candidateCount: totalCandidateCount,
    eligibleCount: candidates.length,
  }
}

export function allocateMultiFarmerOrder(requirement, listings = []) {
  const normReq = normalizeBuyerRequirement(requirement)
  const eligible = filterEligibleListings(listings, normReq)

  if (eligible.length === 0 || normReq.quantity <= 0) {
    const dlv = calculateDeliveryPricing(0, 0)
    return {
      requirement: normReq,
      requestedQuantity: normReq.quantity,
      fulfilledQuantity: 0,
      remainingQuantity: normReq.quantity,
      fulfillmentStatus: 'UNFULFILLED',
      productSubtotal: 0,
      deliveryCharge: dlv.deliveryCharge,
      platformFee: dlv.platformFee,
      discount: dlv.discount,
      netPayable: dlv.netPayable,
      effectivePricePerKg: dlv.effectivePricePerKg,
      deliveryStatus: dlv.deliveryStatus,
      freeDeliveryEligible: dlv.freeDeliveryEligible,
      amountNeededForFreeDelivery: dlv.amountNeededForFreeDelivery,
      deliveryExplanation: dlv.explanation,
      deliveryRuleVersion: dlv.deliveryRuleVersion,
      totalAmount: 0,
      totalEstimatedCost: 0,
      weightedAveragePrice: 0,
      allocations: [],
      candidateCount: listings.length,
      eligibleCount: 0,
    }
  }

  // When variety is unspecified, evaluate homogeneous variety groups so incompatible varieties are never mixed
  if (normReq.isAnyVariety) {
    const varietyGroups = groupListingsByVariety(normReq.crop, eligible)
    const varietyKeys = Object.keys(varietyGroups).filter((v) => varietyGroups[v]?.length > 0)

    if (varietyKeys.length > 1) {
      const candidatePlans = varietyKeys.map((vKey) => {
        const subReq = { ...normReq, variety: vKey, isAnyVariety: false }
        const plan = allocateSingleVarietyPlan(subReq, varietyGroups[vKey], listings.length)
        return { variety: vKey, plan }
      })

      const activePlans = candidatePlans.filter((cp) => cp.plan.fulfilledQuantity > 0)

      if (activePlans.length > 0) {
        activePlans.sort((a, b) => {
          if (b.plan.fulfilledQuantity !== a.plan.fulfilledQuantity) {
            return b.plan.fulfilledQuantity - a.plan.fulfilledQuantity
          }
          const scoreA = a.plan.allocations.reduce((acc, x) => acc + (x.score || 0), 0) / (a.plan.allocations.length || 1)
          const scoreB = b.plan.allocations.reduce((acc, x) => acc + (x.score || 0), 0) / (b.plan.allocations.length || 1)
          if (scoreB !== scoreA) {
            return scoreB - scoreA
          }
          return a.plan.weightedAveragePrice - b.plan.weightedAveragePrice
        })

        const best = activePlans[0].plan
        best.variety = activePlans[0].variety
        best.varietyPlans = candidatePlans.reduce((acc, curr) => {
          acc[curr.variety] = curr.plan
          return acc
        }, {})
        best.eligibleCount = eligible.length
        best.candidateCount = listings.length
        return best
      }
    }
  }

  return allocateSingleVarietyPlan(normReq, eligible, listings.length)
}

/**
 * Group listings by variety for safe presentation when buyer specifies 'Any' variety.
 * Prevents blending incompatible varieties into one homogeneous allocation.
 */
export function groupListingsByVariety(cropOrListings, maybeListings = []) {
  let crop = null
  let listings = []
  if (Array.isArray(cropOrListings)) {
    listings = cropOrListings
    crop = listings[0]?.crop || null
  } else {
    crop = cropOrListings
    listings = maybeListings
  }

  const normCrop = normalizeCropKey(crop)
  const validVarieties = normCrop ? getCropVarieties(normCrop) : []

  const groups = {}
  for (const v of validVarieties) {
    groups[v] = []
  }

  for (const item of listings) {
    const itemCrop = normalizeCropKey(item.crop) || normCrop
    const rawV = item.variety || 'Regular'
    const v = (itemCrop ? normalizeVariety(itemCrop, rawV) : null) || rawV
    if (!groups[v]) groups[v] = []
    groups[v].push(item)
  }

  return groups
}

/**
 * Backward compatibility wrapper for Farmer Portal "Buyer Matches" tab.
 * Evaluates verified marketplace orders for a farmer listing.
 */
export function findBuyerMatches({ listing, orders = null, currentUserId = null, lang = 'en' } = {}) {
  if (!listing || !listing.crop) return []
  const allOrders = orders !== null ? orders : getAllOrders()
  if (!Array.isArray(allOrders) || allOrders.length === 0) return []

  const matches = []
  for (const order of allOrders) {
    if (currentUserId && (order.buyerId === currentUserId || order.buyerMobile === listing.farmerMobile)) {
      continue
    }

    const req = {
      crop: order.crop,
      quantity: order.quantity || order.quantityKg || 0,
      variety: order.variety || null,
      minGrade: order.preferredGrade || order.minGrade || null,
      maxPrice: order.pricePerKg || order.offeredPrice || null,
      buyerLocation: order.buyerLocation || order.location || '',
    }

    const normReq = normalizeBuyerRequirement(req)
    const elig = checkListingEligibility(listing, normReq)
    if (!elig.eligible) continue

    const scoreData = scoreListingMatch(listing, normReq)
    if (scoreData.matchScore <= 0) continue

    matches.push({
      id: order.id || 'demand_' + Math.random().toString(36).substring(2, 8),
      buyerId: order.buyerId || 'buyer_anon',
      buyerName: order.buyerName || 'Verified Buyer',
      buyerMobile: order.buyerMobile ? maskMobile(order.buyerMobile) : '+91 ••••• •••••',
      buyerLocation: order.buyerLocation || order.location || 'Local Market',
      crop: order.crop,
      variety: order.variety || null,
      quantity: order.quantity || 0,
      offeredPrice: order.pricePerKg ?? order.offeredPrice ?? 0,
      matchScore: scoreData.matchScore,
      distanceEstimate: lang === 'hi' ? scoreData.distanceEstimateHi : scoreData.distanceEstimateEn,
      reasons: lang === 'hi' ? scoreData.reasonsHi : scoreData.reasonsEn,
      breakdown: scoreData.breakdown,
      date: order.createdAt || new Date().toISOString(),
    })
  }

  matches.sort((a, b) => b.matchScore - a.matchScore)
  return matches
}

function maskMobile(mobile) {
  if (!mobile || typeof mobile !== 'string') return '+91 ••••• •••••'
  const cleaned = mobile.trim()
  if (cleaned.length < 10) return cleaned
  return `+91 ${cleaned.slice(0, 2)}****${cleaned.slice(-4)}`
}

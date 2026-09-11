// server/matchingEngine.js
// BFM-001 Server Matching, Scoring, and Greedy Multi-Farmer Allocation Engine

import {
  CROP_BASE_PRICES,
  normalizeCropKey,
  normalizeVariety,
  getCropVarieties,
} from './cropConstants.js';

export function normalizeLocationTokens(loc) {
  if (!loc || typeof loc !== 'string') return [];
  return loc
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_~()]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

export function calculateLocationProximity(farmerLoc, buyerLoc) {
  const fTokens = normalizeLocationTokens(farmerLoc);
  const bTokens = normalizeLocationTokens(buyerLoc);

  if (fTokens.length === 0 || bTokens.length === 0) {
    return {
      score: 12,
      distanceKm: 150,
      labelEn: 'Location estimate pending (~150 km)',
      tier: 'unknown',
    };
  }

  const commonTokens = fTokens.filter((t) => bTokens.includes(t));

  const stateKeywords = [
    'maharashtra', 'haryana', 'punjab', 'rajasthan', 'gujarat',
    'karnataka', 'tamil', 'nadu', 'kerala', 'uttar', 'pradesh',
    'madhya', 'bihar', 'bengal', 'odisha', 'andhra', 'telangana', 'delhi'
  ];

  const isStateMatch = commonTokens.some((t) => stateKeywords.includes(t));
  const isCityMatch = commonTokens.some((t) => !stateKeywords.includes(t));

  if (isCityMatch) {
    return {
      score: 25,
      distanceKm: 25,
      labelEn: 'Local (~15–30 km)',
      tier: 'local',
    };
  }

  if (isStateMatch || commonTokens.length > 0) {
    return {
      score: 18,
      distanceKm: 100,
      labelEn: 'Regional (~80–150 km)',
      tier: 'regional',
    };
  }

  return {
    score: 10,
    distanceKm: 450,
    labelEn: 'Inter-state transport (~300–600 km)',
    tier: 'interstate',
  };
}

export function getGradeRank(grade) {
  if (!grade) return 2;
  const g = String(grade).toUpperCase().trim();
  if (g === 'A') return 3;
  if (g === 'B') return 2;
  if (g === 'C') return 1;
  return 2;
}

export function normalizeBuyerRequirement(req = {}) {
  const crop = normalizeCropKey(req.crop || req.product);
  const quantity = Math.max(0, parseFloat(req.quantity) || 0);
  const rawVariety = req.variety ? String(req.variety).trim() : null;
  const variety = (!rawVariety || rawVariety.toLowerCase() === 'any' || rawVariety.toLowerCase() === 'all')
    ? null
    : normalizeVariety(crop, rawVariety);

  const minGrade = req.minGrade && ['A', 'B', 'C'].includes(String(req.minGrade).toUpperCase())
    ? String(req.minGrade).toUpperCase()
    : null;

  const maxPrice = req.maxPrice ? parseFloat(req.maxPrice) : null;
  const maxDistance = req.maxDistance ? parseFloat(req.maxDistance) : null;
  const buyerLocation = (req.buyerLocation || req.location || '').trim();

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
  };
}

export function checkListingEligibility(listing, requirement, excludedFarmerIds = []) {
  if (!listing || !requirement) {
    return { eligible: false, reason: 'Invalid listing or requirement payload' };
  }

  if (excludedFarmerIds.includes(listing.farmerId) || excludedFarmerIds.includes(listing.id)) {
    return { eligible: false, reason: 'Listing / Farmer is excluded' };
  }

  if (listing.status === 'Sold Out' || listing.status === 'Sold' || listing.moderationStatus === 'rejected') {
    return { eligible: false, reason: 'Listing is inactive or sold out' };
  }

  const availableQty = Math.max(0, (listing.quantity || 0) - (listing.reservedQuantity || 0));
  if (availableQty <= 0) {
    return { eligible: false, reason: 'No available unreserved inventory' };
  }

  // 1. Mandatory Crop Match
  const listingCrop = normalizeCropKey(listing.crop);
  if (!listingCrop || listingCrop !== requirement.crop) {
    return { eligible: false, reason: `Crop mismatch: requires ${requirement.crop}, listing is ${listing.crop}` };
  }

  // 2. Variety Safety
  if (!requirement.isAnyVariety && requirement.variety) {
    const reqVarNorm = normalizeVariety(requirement.crop, requirement.variety);
    const listVarNorm = normalizeVariety(listing.crop, listing.variety);
    if (!listVarNorm || listVarNorm.toLowerCase() !== reqVarNorm.toLowerCase()) {
      return {
        eligible: false,
        reason: `Variety mismatch: requires ${requirement.variety}, listing is ${listing.variety || 'Unknown'}`,
      };
    }
  }

  // 3. Minimum Grade
  if (requirement.minGrade) {
    const listGrade = listing.quality?.grade || listing.grade || null;
    const listRank = getGradeRank(listGrade);
    const reqRank = getGradeRank(requirement.minGrade);
    if (listRank < reqRank) {
      return {
        eligible: false,
        reason: `Grade below requirement: requires Grade ${requirement.minGrade}, listing is Grade ${listGrade || 'C'}`,
      };
    }
  }

  // 4. Maximum Price
  if (requirement.maxPrice !== null) {
    const askingPrice = parseFloat(listing.price ?? listing.expectedPrice ?? 0);
    if (askingPrice > requirement.maxPrice) {
      return {
        eligible: false,
        reason: `Price exceeds ceiling: asking ₹${askingPrice}/kg, max offered ₹${requirement.maxPrice}/kg`,
      };
    }
  }

  // 5. Maximum Distance
  if (requirement.maxDistance !== null) {
    const prox = calculateLocationProximity(listing.location, requirement.buyerLocation);
    if (prox.distanceKm > requirement.maxDistance) {
      return {
        eligible: false,
        reason: `Distance exceeds radius: ~${prox.distanceKm} km vs max ${requirement.maxDistance} km`,
      };
    }
  }

  return { eligible: true };
}

export function scoreListingMatch(listing, requirement) {
  const normReq = normalizeBuyerRequirement(requirement);
  const eligCheck = checkListingEligibility(listing, normReq);
  if (!eligCheck.eligible) {
    return {
      matchScore: 0,
      eligible: false,
      reasonsEn: [eligCheck.reason || 'Not eligible'],
      breakdown: { price: 0, distance: 0, quantityFit: 0, quality: 0, logistics: 0 },
    };
  }

  const crop = normReq.crop;
  const basePrice = CROP_BASE_PRICES[crop] || 35;
  const askingPrice = parseFloat(listing.price ?? listing.expectedPrice ?? basePrice);
  const targetPrice = normReq.maxPrice || basePrice;

  // 1. Price Competitiveness (up to 30 pts)
  let priceScore = 20;
  if (askingPrice <= targetPrice * 0.9) {
    priceScore = 30;
  } else if (askingPrice <= targetPrice) {
    priceScore = 25;
  } else {
    const ratio = targetPrice / askingPrice;
    priceScore = Math.max(5, Math.round(25 * ratio));
  }

  // 2. Distance / Proximity (up to 25 pts)
  const locResult = calculateLocationProximity(listing.location, normReq.buyerLocation);
  const distanceScore = locResult.score;

  // 3. Quantity Fit / Reducing Farmer Count (up to 25 pts)
  const availableQty = Math.max(0, (listing.quantity || 0) - (listing.reservedQuantity || 0));
  const neededQty = normReq.quantity || 1;
  let quantityFitScore = 10;
  if (availableQty >= neededQty) {
    quantityFitScore = 25;
  } else {
    const coverageRatio = availableQty / neededQty;
    if (coverageRatio >= 0.7) quantityFitScore = 22;
    else if (coverageRatio >= 0.4) quantityFitScore = 18;
    else if (coverageRatio >= 0.2) quantityFitScore = 14;
    else quantityFitScore = 10;
  }

  // 4. Quality Grade (up to 12 pts)
  const grade = listing.quality?.grade || listing.grade || 'B';
  let qualityScore = 9;
  if (grade === 'A') qualityScore = 12;
  else if (grade === 'B') qualityScore = 9;
  else if (grade === 'C') qualityScore = 5;

  // 5. Logistics Compatibility (up to 8 pts)
  let logisticsScore = 6;
  if (listing.pickupDecision?.method === 'HOME' && availableQty >= 100) {
    logisticsScore = 8;
  } else if (listing.pickupDecision?.method === 'HUB') {
    logisticsScore = 7;
  }

  const totalScore = Math.min(100, priceScore + distanceScore + quantityFitScore + qualityScore + logisticsScore);

  const reasonsEn = [
    `Price ₹${askingPrice}/kg (${priceScore}/30 pts)`,
    `${locResult.labelEn} (${distanceScore}/25 pts)`,
    `Supplies ${Math.min(availableQty, neededQty)} kg towards demand (${quantityFitScore}/25 pts)`,
    `Quality Grade ${grade} (${qualityScore}/12 pts)`,
    `Pickup: ${listing.pickupDecision?.method || 'Standard'} (${logisticsScore}/8 pts)`,
  ];

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
    distanceKm: locResult.distanceKm,
    distanceEstimateEn: locResult.labelEn,
  };
}

function allocateSingleVarietyPlan(normReq, candidates = [], totalCandidateCount = candidates.length) {
  if (candidates.length === 0 || normReq.quantity <= 0) {
    return {
      requirement: normReq,
      requestedQuantity: normReq.quantity,
      fulfilledQuantity: 0,
      remainingQuantity: normReq.quantity,
      matchStatus: 'NO_MATCH',
      fulfillmentStatus: 'UNFULFILLED',
      totalAmount: 0,
      totalEstimatedCost: 0,
      weightedAveragePrice: 0,
      allocations: [],
      candidateCount: totalCandidateCount,
      eligibleCount: 0,
    };
  }

  const scored = candidates.map((item) => {
    const analysis = scoreListingMatch(item, normReq);
    const availableQty = Math.max(0, (item.quantity || 0) - (item.reservedQuantity || 0));
    return {
      listing: item,
      availableQuantity: availableQty,
      score: analysis.matchScore,
      breakdown: analysis.breakdown,
      reasonsEn: analysis.reasonsEn,
      distanceKm: analysis.distanceKm,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.availableQuantity - a.availableQuantity;
  });

  let remainingDemand = normReq.quantity;
  const allocations = [];
  let totalAmount = 0;

  for (const candidate of scored) {
    if (remainingDemand <= 0) break;
    const { listing, availableQuantity, score, breakdown, reasonsEn } = candidate;
    if (availableQuantity <= 0) continue;

    const allocatedQty = Math.min(availableQuantity, remainingDemand);
    const unitPrice = parseFloat(listing.price ?? listing.expectedPrice ?? 0);
    const itemTotal = Math.round(allocatedQty * unitPrice * 100) / 100;

    const allocId = 'ALC_' + Date.now().toString().slice(-6) + '_' + Math.random().toString(36).substring(2, 6);
    allocations.push({
      id: allocId,
      allocationId: allocId,
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
      createdAt: new Date().toISOString(),
    });

    totalAmount += itemTotal;
    remainingDemand -= allocatedQty;
  }

  const fulfilledQuantity = Math.round((normReq.quantity - remainingDemand) * 100) / 100;
  const remainingQuantity = Math.max(0, Math.round(remainingDemand * 100) / 100);
  const matchStatus = remainingQuantity === 0 ? 'FULL' : (fulfilledQuantity > 0 ? 'PARTIAL' : 'NO_MATCH');
  const fulfillmentStatus = remainingQuantity === 0 ? 'FULFILLED' : (fulfilledQuantity > 0 ? 'PARTIAL' : 'UNFULFILLED');
  const weightedAveragePrice = fulfilledQuantity > 0 ? Math.round((totalAmount / fulfilledQuantity) * 100) / 100 : 0;

  return {
    requirement: normReq,
    requestedQuantity: normReq.quantity,
    fulfilledQuantity,
    remainingQuantity,
    matchStatus,
    fulfillmentStatus,
    totalAmount: Math.round(totalAmount * 100) / 100,
    totalEstimatedCost: Math.round(totalAmount * 100) / 100,
    weightedAveragePrice,
    allocations,
    candidateCount: totalCandidateCount,
    eligibleCount: candidates.length,
  };
}

export function allocateMultiFarmerOrder(requirement, listings = [], excludedFarmerIds = []) {
  const normReq = normalizeBuyerRequirement(requirement);
  const eligible = listings.filter((l) => checkListingEligibility(l, normReq, excludedFarmerIds).eligible);

  if (eligible.length === 0 || normReq.quantity <= 0) {
    return {
      requirement: normReq,
      requestedQuantity: normReq.quantity,
      fulfilledQuantity: 0,
      remainingQuantity: normReq.quantity,
      matchStatus: 'NO_MATCH',
      fulfillmentStatus: 'UNFULFILLED',
      totalAmount: 0,
      totalEstimatedCost: 0,
      weightedAveragePrice: 0,
      allocations: [],
      candidateCount: listings.length,
      eligibleCount: 0,
    };
  }

  // When variety is unspecified, evaluate homogeneous variety groups so incompatible varieties are never mixed
  if (normReq.isAnyVariety) {
    const varietyGroups = groupListingsByVariety(eligible);
    const varietyKeys = Object.keys(varietyGroups).filter((v) => varietyGroups[v]?.length > 0);

    if (varietyKeys.length > 1) {
      // Evaluate homogeneous allocation plans for each variety group separately
      const candidatePlans = varietyKeys.map((vKey) => {
        const subReq = { ...normReq, variety: vKey, isAnyVariety: false };
        const plan = allocateSingleVarietyPlan(subReq, varietyGroups[vKey], listings.length);
        return { variety: vKey, plan };
      });

      // Filter to plans with fulfillment > 0
      const activePlans = candidatePlans.filter((cp) => cp.plan.fulfilledQuantity > 0);

      if (activePlans.length > 0) {
        // Rank candidate plans:
        // 1. Higher fulfilledQuantity (maximize order fulfillment)
        // 2. Higher average allocation score
        // 3. Lower weightedAveragePrice
        activePlans.sort((a, b) => {
          if (b.plan.fulfilledQuantity !== a.plan.fulfilledQuantity) {
            return b.plan.fulfilledQuantity - a.plan.fulfilledQuantity;
          }
          const scoreA = a.plan.allocations.reduce((acc, x) => acc + (x.score || 0), 0) / (a.plan.allocations.length || 1);
          const scoreB = b.plan.allocations.reduce((acc, x) => acc + (x.score || 0), 0) / (b.plan.allocations.length || 1);
          if (scoreB !== scoreA) {
            return scoreB - scoreA;
          }
          return a.plan.weightedAveragePrice - b.plan.weightedAveragePrice;
        });

        const best = activePlans[0].plan;
        best.variety = activePlans[0].variety;
        best.varietyPlans = candidatePlans.reduce((acc, curr) => {
          acc[curr.variety] = curr.plan;
          return acc;
        }, {});
        best.eligibleCount = eligible.length;
        best.candidateCount = listings.length;
        return best;
      }
    }
  }

  return allocateSingleVarietyPlan(normReq, eligible, listings.length);
}

export function groupListingsByVariety(listings = []) {
  const groups = {};
  for (const item of listings) {
    const rawV = item.variety || 'Regular';
    const v = (item.crop ? normalizeVariety(item.crop, rawV) : null) || rawV;
    if (!groups[v]) groups[v] = [];
    groups[v].push(item);
  }
  return groups;
}

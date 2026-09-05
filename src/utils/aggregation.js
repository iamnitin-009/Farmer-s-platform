// src/utils/aggregation.js
// Deterministic Produce Hub Aggregation Engine for SIH 2026

/**
 * Checks if an individual listing qualifies for Hub Aggregation.
 *
 * Rules:
 * 1. Valid non-empty crop (matches target crop if specified).
 * 2. Valid quantity > 0.
 * 3. Smart Pickup Decision must be HUB (excludes HOME/farmgate pickup).
 * 4. Active listing (status !== 'Sold').
 *
 * @param {object} listing - Farmer produce listing
 * @param {string} [crop] - Optional crop name to filter against
 * @returns {boolean}
 */
export function isEligibleForHubListing(listing, crop = null) {
  if (!listing || typeof listing !== 'object') return false

  // 1. Crop check
  if (!listing.crop || typeof listing.crop !== 'string' || listing.crop.trim() === '') {
    return false
  }
  if (crop && typeof crop === 'string' && crop.trim() !== '') {
    if (listing.crop.toLowerCase().trim() !== crop.toLowerCase().trim()) {
      return false
    }
  }

  // 2. Quantity check
  const qty = typeof listing.quantity === 'number' ? listing.quantity : parseFloat(listing.quantity)
  if (isNaN(qty) || qty <= 0) {
    return false
  }

  // 3. Smart Pickup Decision check (strictly HUB)
  if (!listing.pickupDecision || listing.pickupDecision.method !== 'HUB') {
    return false
  }

  // 4. Status check (active only)
  if (listing.status && String(listing.status).toLowerCase() === 'sold') {
    return false
  }

  return true
}

/**
 * Filters listings to only those qualifying for Hub Aggregation.
 *
 * @param {Array<object>} listings
 * @param {string} [crop] - Optional target crop
 * @returns {Array<object>}
 */
export function getEligibleHubListings(listings, crop = null) {
  if (!Array.isArray(listings)) return []
  return listings.filter((item) => isEligibleForHubListing(item, crop))
}

/**
 * Aggregates eligible hub listings for a crop into a combined lot with
 * quantity-weighted prices and quality grade breakdown.
 *
 * @param {Array<object>} listings
 * @param {string} [crop=null] - Specific crop or null for all
 * @returns {{
 *   crop: string,
 *   totalQuantityKg: number,
 *   farmerCount: number,
 *   listingCount: number,
 *   averagePricePerKg: number,
 *   fairPricePerKg: number,
 *   qualityBreakdown: { A: number, B: number, C: number, unassessed: number },
 *   contributors: Array<object>
 * }}
 */
export function aggregateHubLots(listings, crop = null) {
  const eligible = getEligibleHubListings(listings, crop)
  const normalizedCrop = crop && typeof crop === 'string' ? crop.toLowerCase().trim() : 'all'

  if (!eligible || eligible.length === 0) {
    return {
      crop: normalizedCrop,
      totalQuantityKg: 0,
      farmerCount: 0,
      listingCount: 0,
      averagePricePerKg: 0,
      fairPricePerKg: 0,
      qualityBreakdown: { A: 0, B: 0, C: 0, unassessed: 0 },
      contributors: [],
    }
  }

  let totalQuantityKg = 0
  let totalAskingValue = 0
  let totalFairValue = 0

  const uniqueFarmers = new Set()
  const qualityBreakdown = { A: 0, B: 0, C: 0, unassessed: 0 }
  const contributors = []

  for (const item of eligible) {
    const qty = typeof item.quantity === 'number' ? item.quantity : parseFloat(item.quantity)
    const askingPrice = typeof item.price === 'number'
      ? item.price
      : (parseFloat(item.price) || parseFloat(item.expectedPrice) || 0)

    // Fair price: prefer existing fairPrice.suggestedPrice; fall back to asking price
    let fairPrice = askingPrice
    if (item.fairPrice && item.fairPrice.suggestedPrice !== undefined) {
      const parsedFair = typeof item.fairPrice.suggestedPrice === 'number'
        ? item.fairPrice.suggestedPrice
        : parseFloat(item.fairPrice.suggestedPrice)
      if (!isNaN(parsedFair) && parsedFair > 0) {
        fairPrice = parsedFair
      }
    }

    totalQuantityKg += qty
    totalAskingValue += qty * askingPrice
    totalFairValue += qty * fairPrice

    // Unique farmer deduplication (uses farmerId, farmerMobile, farmerName, or fallback)
    const farmerId = item.farmerId || item.farmerMobile || item.farmerName || ('farmer_' + item.id)
    uniqueFarmers.add(String(farmerId))

    // Quality breakdown
    const grade = item.quality && item.quality.grade
      ? String(item.quality.grade).toUpperCase().trim()
      : null

    if (grade === 'A') qualityBreakdown.A += qty
    else if (grade === 'B') qualityBreakdown.B += qty
    else if (grade === 'C') qualityBreakdown.C += qty
    else qualityBreakdown.unassessed += qty

    // Contributor presentation (privacy-safe: only standard marketplace info)
    contributors.push({
      listingId: item.id,
      farmerName: item.farmerName || 'Local Farmer',
      location: item.location || 'Local Hub Area',
      crop: item.crop,
      quantityKg: Number(qty.toFixed(2)),
      pricePerKg: Number(askingPrice.toFixed(2)),
      fairPricePerKg: Number(fairPrice.toFixed(2)),
      grade: (grade === 'A' || grade === 'B' || grade === 'C') ? grade : 'Unassessed',
      qualityScore: item.quality?.score ?? null,
      harvestDate: item.harvestDate || '',
      pickupDecision: item.pickupDecision,
    })
  }

  const averagePricePerKg = totalQuantityKg > 0
    ? Number((totalAskingValue / totalQuantityKg).toFixed(2))
    : 0

  const fairPricePerKg = totalQuantityKg > 0
    ? Number((totalFairValue / totalQuantityKg).toFixed(2))
    : 0

  return {
    crop: normalizedCrop,
    totalQuantityKg: Number(totalQuantityKg.toFixed(2)),
    farmerCount: uniqueFarmers.size,
    listingCount: eligible.length,
    averagePricePerKg,
    fairPricePerKg,
    qualityBreakdown: {
      A: Number(qualityBreakdown.A.toFixed(2)),
      B: Number(qualityBreakdown.B.toFixed(2)),
      C: Number(qualityBreakdown.C.toFixed(2)),
      unassessed: Number(qualityBreakdown.unassessed.toFixed(2)),
    },
    contributors,
  }
}

/**
 * Returns a map of aggregated hub lots for all crops currently available in eligible listings.
 *
 * @param {Array<object>} listings
 * @returns {Record<string, ReturnType<typeof aggregateHubLots>>}
 */
export function getAllHubAggregations(listings) {
  const eligible = getEligibleHubListings(listings)
  const crops = new Set(eligible.map((item) => item.crop.toLowerCase().trim()))

  const result = {}
  for (const c of crops) {
    result[c] = aggregateHubLots(eligible, c)
  }
  return result
}

/**
 * Quick helper to get total aggregated kg for a given crop.
 *
 * @param {Array<object>} listings
 * @param {string} crop
 * @returns {number}
 */
export function getAggregatedCropTotal(listings, crop) {
  if (!crop) return 0
  const agg = aggregateHubLots(listings, crop)
  return agg.totalQuantityKg
}

/**
 * Quick helper to get contributing farmer count for a given crop.
 *
 * @param {Array<object>} listings
 * @param {string} crop
 * @returns {number}
 */
export function getAggregatedCropFarmerCount(listings, crop) {
  if (!crop) return 0
  const agg = aggregateHubLots(listings, crop)
  return agg.farmerCount
}

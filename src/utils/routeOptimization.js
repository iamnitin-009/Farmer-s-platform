// src/utils/routeOptimization.js
// Deterministic Nearest-Neighbor Route Optimization Engine for SIH 2026
import { CROP_KEYS } from './cropConstants.js'

/**
 * Predefined geographic coordinates [latitude, longitude] for primary
 * Indian agricultural mandis and major consumption centers.
 */
export const KNOWN_COORDINATES = {
  karnal: [29.6857, 76.9905],
  delhi: [28.6139, 77.2090],
  azadpur: [28.7159, 77.1788],
  ghaziabad: [28.6692, 77.4538],
  noida: [28.5355, 77.3910],
  gurgaon: [28.4595, 77.0266],
  gurugram: [28.4595, 77.0266],
  faridabad: [28.4089, 77.3178],
  sonipat: [28.9931, 77.0151],
  panipat: [29.3909, 76.9635],
  meerut: [28.9845, 77.7064],
  agra: [27.1767, 78.0081],
  jaipur: [26.9124, 75.7873],
  nashik: [19.9975, 73.7898],
  pune: [18.5204, 73.8567],
  mumbai: [19.0760, 72.8777],
  lucknow: [26.8467, 80.9462],
  chandigarh: [30.7333, 76.7794],
  ludhiana: [30.9010, 75.8573],
  ambala: [30.3782, 76.7767],
}

/**
 * Deterministic hash for string to generate consistent pseudo-offsets.
 * @param {string} str
 * @returns {number}
 */
function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/**
 * Resolves coordinates for a location string deterministically.
 *
 * @param {string} loc
 * @param {[number, number]} [refCoords=[28.6139, 77.2090]]
 * @returns {[number, number]} [lat, lon]
 */
export function resolveLocationCoordinates(loc, refCoords = [28.6139, 77.2090]) {
  if (!loc || typeof loc !== 'string') return refCoords

  const clean = loc.toLowerCase().trim()
  for (const [key, coords] of Object.entries(KNOWN_COORDINATES)) {
    if (clean.includes(key)) {
      return coords
    }
  }

  // Deterministic regional offset for unknown locations
  const h = hashString(clean)
  const latOffset = ((h % 100) - 50) / 300 // +/- ~0.15 deg (~16 km)
  const lonOffset = (((h >> 3) % 100) - 50) / 300
  return [refCoords[0] + latOffset, refCoords[1] + lonOffset]
}

/**
 * Calculates deterministic road distance in km between two locations.
 * Uses Haversine spherical distance multiplied by 1.25 winding road factor.
 *
 * @param {string|[number, number]} locA
 * @param {string|[number, number]} locB
 * @returns {number} Distance in kilometers
 */
export function calculateDistanceKm(locA, locB) {
  const coordsA = Array.isArray(locA) ? locA : resolveLocationCoordinates(locA)
  const coordsB = Array.isArray(locB) ? locB : resolveLocationCoordinates(locB)

  const [lat1, lon1] = coordsA
  const [lat2, lon2] = coordsB

  if (lat1 === lat2 && lon1 === lon2) return 0

  const R = 6371 // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const aerialDistance = R * c
  const roadFactor = 1.25 // Standard urban/semi-urban road winding factor
  const roadDistance = aerialDistance * roadFactor

  return Number(Math.max(1, roadDistance).toFixed(1))
}

/**
 * Returns default demo buyer destinations for testing and SIH presentation.
 *
 * @param {string} [crop='tomato']
 * @param {number} [totalQty=90]
 * @returns {Array<object>}
 */
export function getDemoBuyerDestinations(crop = (CROP_KEYS[0] || 'rice'), totalQty = 90) {
  const q1 = Math.round(totalQty * 0.3)
  const q2 = Math.round(totalQty * 0.35)
  const q3 = Math.max(1, totalQty - q1 - q2)

  return [
    {
      id: 'BUYER_DELHI',
      buyerName: 'Rohan Sharma (Apex Wholesale)',
      location: 'Delhi',
      quantityKg: q1,
      preferredGrade: 'A',
      crop,
    },
    {
      id: 'BUYER_GHAZIABAD',
      buyerName: 'Amit Patel (Subzi Mart)',
      location: 'Ghaziabad',
      quantityKg: q2,
      preferredGrade: 'B',
      crop,
    },
    {
      id: 'BUYER_NOIDA',
      buyerName: 'Pooja Verma (Fresh Basket Organics)',
      location: 'Noida',
      quantityKg: q3,
      preferredGrade: 'A',
      crop,
    },
  ]
}

/**
 * Optimizes the delivery route from an aggregation hub to multiple buyer destinations
 * using a transparent nearest-neighbor heuristic.
 *
 * @param {object} params
 * @param {string} [params.hubLocation='Azadpur Mandi Hub, Delhi'] - Origin hub location
 * @param {string} [params.crop='rice'] - Aggregated produce crop
 * @param {Array<object>} params.buyers - List of buyer delivery destinations
 * @param {string} [params.lang='en'] - Language ('en' | 'hi')
 * @returns {{
 *   totalStops: number,
 *   totalDistanceKm: number,
 *   estimatedTimeMinutes: number,
 *   route: Array<{
 *     stopNumber: number,
 *     buyerId: string,
 *     buyerName: string,
 *     location: string,
 *     quantityKg: number,
 *     distanceFromPreviousKm: number,
 *     cumulativeDistanceKm: number,
 *     estimatedArrivalMinutes: number,
 *   }>,
 *   hub: {
 *     name: string,
 *     crop: string,
 *     totalQuantityKg: number,
 *   },
 *   optimizationSummary: string,
 *   method: string,
 * }}
 */
export function optimizeDeliveryRoute({
  hubLocation = 'Azadpur Mandi Hub, Delhi',
  crop = (CROP_KEYS[0] || 'rice'),
  buyers = [],
  lang = 'en',
} = {}) {
  const normCrop = crop ? crop.toLowerCase().trim() : (CROP_KEYS[0] || 'rice')
  const validBuyers = Array.isArray(buyers)
    ? buyers.filter((b) => b && typeof b === 'object' && (b.location || b.buyerLocation))
    : []

  if (validBuyers.length === 0) {
    return {
      totalStops: 0,
      totalDistanceKm: 0,
      estimatedTimeMinutes: 0,
      route: [],
      hub: {
        name: hubLocation,
        crop: normCrop,
        totalQuantityKg: 0,
      },
      optimizationSummary:
        lang === 'hi'
          ? 'मार्ग अनुकूलन के लिए कोई खरीदार गंतव्य उपलब्ध नहीं है।'
          : 'No buyer destinations available for route optimization.',
      method: 'Nearest-neighbor heuristic (deterministic demo-distance model)',
    }
  }

  // Pre-normalize buyers
  const unvisited = validBuyers.map((b, idx) => {
    const loc = b.location || b.buyerLocation || 'Local Market'
    const qty = typeof b.quantityKg === 'number'
      ? b.quantityKg
      : typeof b.quantity === 'number'
      ? b.quantity
      : parseFloat(b.quantityKg || b.quantity || 0) || 10

    return {
      id: b.id || b.buyerId || ('buyer_' + (idx + 1)),
      name: b.buyerName || b.name || ('Buyer ' + (idx + 1)),
      location: loc,
      quantityKg: Number(qty.toFixed(1)),
      explicitDistanceKm: typeof b.distanceKm === 'number'
        ? b.distanceKm
        : typeof b.distanceFromPreviousKm === 'number'
        ? b.distanceFromPreviousKm
        : null,
    }
  })

  const totalQuantityKg = Number(
    unvisited.reduce((sum, b) => sum + b.quantityKg, 0).toFixed(1)
  )

  let currentLocation = hubLocation
  let cumulativeDistanceKm = 0
  let cumulativeTravelMinutes = 0
  const route = []

  // Average commercial transit speed in urban/semi-urban India: 35 km/h
  const SPEED_KMH = 35
  const STOP_TURNAROUND_MINUTES = 10 // unloading and handover time per stop

  while (unvisited.length > 0) {
    // Find nearest unvisited buyer from currentLocation
    let bestIndex = 0
    let bestDistance = Infinity

    for (let i = 0; i < unvisited.length; i++) {
      const candidate = unvisited[i]
      let dist = candidate.explicitDistanceKm !== null
        ? candidate.explicitDistanceKm
        : calculateDistanceKm(currentLocation, candidate.location)

      if (dist < bestDistance) {
        bestDistance = dist
        bestIndex = i
      }
    }

    const nextStop = unvisited.splice(bestIndex, 1)[0]
    const segmentKm = bestDistance

    // Segment travel time in minutes
    const segmentMinutes = Math.max(5, Math.round((segmentKm / SPEED_KMH) * 60))

    cumulativeDistanceKm += segmentKm
    cumulativeTravelMinutes += segmentMinutes

    const stopNumber = route.length + 1
    const estimatedArrivalMinutes =
      cumulativeTravelMinutes + (stopNumber - 1) * STOP_TURNAROUND_MINUTES

    route.push({
      stopNumber,
      buyerId: nextStop.id,
      buyerName: nextStop.name,
      location: nextStop.location,
      quantityKg: nextStop.quantityKg,
      distanceFromPreviousKm: Number(segmentKm.toFixed(1)),
      cumulativeDistanceKm: Number(cumulativeDistanceKm.toFixed(1)),
      estimatedArrivalMinutes,
    })

    currentLocation = nextStop.location
  }

  const finalTotalDistanceKm = Number(cumulativeDistanceKm.toFixed(1))
  const finalTotalMinutes =
    cumulativeTravelMinutes + route.length * STOP_TURNAROUND_MINUTES

  const optimizationSummary =
    lang === 'hi'
      ? ('हब (' + hubLocation + ') से ' + route.length + ' खरीदार स्टॉप के लिए निकटतम-पड़ोसी विधि से अनुकूलित मार्ग। कुल दूरी: ' + finalTotalDistanceKm + ' किमी, अनुमानित समय: ' + finalTotalMinutes + ' मिनट।')
      : ('Nearest-neighbor optimized delivery sequence from Hub (' + hubLocation + ') across ' + route.length + ' buyer stops. Total distance: ' + finalTotalDistanceKm + ' km, estimated transit time: ' + finalTotalMinutes + ' min.')

  return {
    totalStops: route.length,
    totalDistanceKm: finalTotalDistanceKm,
    estimatedTimeMinutes: finalTotalMinutes,
    route,
    hub: {
      name: hubLocation,
      crop: normCrop,
      totalQuantityKg,
    },
    optimizationSummary,
    method: 'Nearest-neighbor heuristic (deterministic demo-distance model)',
  }
}

/**
 * Storage helpers for persisting generated delivery routes
 */
const STORAGE_ROUTES_KEY = 'sih_routes'

export function saveOptimizedRoute(routeData) {
  try {
    const raw = localStorage.getItem(STORAGE_ROUTES_KEY)
    const routes = raw ? JSON.parse(raw) : []
    const entry = {
      ...routeData,
      savedAt: new Date().toISOString(),
    }
    routes.unshift(entry)
    localStorage.setItem(STORAGE_ROUTES_KEY, JSON.stringify(routes.slice(0, 10)))
    return true
  } catch (e) {
    console.error('Error saving route to localStorage:', e)
    return false
  }
}

export function getLatestOptimizedRoute() {
  try {
    const raw = localStorage.getItem(STORAGE_ROUTES_KEY)
    const routes = raw ? JSON.parse(raw) : []
    return routes.length > 0 ? routes[0] : null
  } catch {
    return null
  }
}

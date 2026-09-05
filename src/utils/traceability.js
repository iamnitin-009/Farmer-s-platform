// src/utils/traceability.js
// Product Traceability QR and Lifecycle Journey Engine for SIH 2026 MVP
// Generates stable traceability IDs, builds chronological farm-to-consumer journey graphs,
// and manages QR data encoding without exposing sensitive private credentials.

import QRCode from 'qrcode'
import { getAllHubAggregations } from './aggregation.js'

export const TRACEABILITY_STORAGE_KEY = 'sih_traceability'
export const FARMER_LISTINGS_KEY = 'sih_farmer_listings'
export const BUYER_ORDERS_KEY = 'sih_buyer_orders'
export const ROUTES_KEY = 'sih_routes'

/**
 * Generate or preserve a stable unique traceability ID.
 * Format: TRC-2026-XXXXXX (6 alphanumeric uppercase chars)
 */
export function createTraceabilityId(seed = '') {
  if (typeof seed === 'string' && seed.startsWith('TRC-2026-')) {
    return seed
  }

  let suffix = ''
  if (typeof seed === 'object' && seed !== null) {
    if (seed.traceabilityId && seed.traceabilityId.startsWith('TRC-2026-')) {
      return seed.traceabilityId
    }
    const seedStr = seed.id || seed.orderId || seed.crop || ''
    suffix = String(seedStr).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()
  } else if (typeof seed === 'string' && seed.length > 0) {
    suffix = seed.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()
  }

  if (suffix.length < 6) {
    const pad = Math.random().toString(36).substring(2, 8).toUpperCase()
    suffix = (suffix + pad).slice(0, 6)
  }

  return `TRC-2026-${suffix}`
}

/**
 * Register lightweight mapping in localStorage without duplicating entire listings/orders
 */
export function registerTraceabilityMapping(traceabilityId, { listingId, orderId } = {}) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = localStorage.getItem(TRACEABILITY_STORAGE_KEY)
    const list = raw ? JSON.parse(raw) : []

    const existingIdx = list.findIndex((m) => m.traceabilityId === traceabilityId)
    const entry = {
      traceabilityId,
      listingId: listingId || (existingIdx >= 0 ? list[existingIdx].listingId : null),
      orderId: orderId || (existingIdx >= 0 ? list[existingIdx].orderId : null),
      updatedAt: new Date().toISOString(),
    }

    if (existingIdx >= 0) {
      list[existingIdx] = entry
    } else {
      list.unshift(entry)
    }

    localStorage.setItem(TRACEABILITY_STORAGE_KEY, JSON.stringify(list))
    return entry
  } catch (e) {
    console.error('Error registering traceability mapping:', e)
    return null
  }
}

/**
 * Ensure a listing has a stable traceability ID and registers its mapping
 */
export function ensureListingTraceabilityId(listing) {
  if (!listing) return null
  if (listing.traceabilityId && listing.traceabilityId.startsWith('TRC-2026-')) {
    registerTraceabilityMapping(listing.traceabilityId, { listingId: listing.id })
    return listing.traceabilityId
  }

  const tid = createTraceabilityId(listing)
  listing.traceabilityId = tid
  registerTraceabilityMapping(tid, { listingId: listing.id })

  // Update in localStorage if available
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(FARMER_LISTINGS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        const updated = parsed.map((item) => (item.id === listing.id ? { ...item, traceabilityId: tid } : item))
        localStorage.setItem(FARMER_LISTINGS_KEY, JSON.stringify(updated))
      }
    }
  } catch (e) {
    console.error('Error persisting listing traceabilityId:', e)
  }

  return tid
}

/**
 * Ensure an order has a stable traceability ID and registers its mapping
 */
export function ensureOrderTraceabilityId(order) {
  if (!order) return null
  if (order.traceabilityId && order.traceabilityId.startsWith('TRC-2026-')) {
    registerTraceabilityMapping(order.traceabilityId, { orderId: order.orderId || order.id, listingId: order.listingId })
    return order.traceabilityId
  }

  // Inherit listing's traceabilityId if known, otherwise create one
  let tid = null
  try {
    if (typeof window !== 'undefined' && window.localStorage && order.listingId) {
      const raw = localStorage.getItem(FARMER_LISTINGS_KEY)
      if (raw) {
        const listings = JSON.parse(raw)
        const matchedListing = listings.find((l) => l.id === order.listingId)
        if (matchedListing?.traceabilityId) {
          tid = matchedListing.traceabilityId
        }
      }
    }
  } catch {
    // ignore
  }

  if (!tid) {
    tid = createTraceabilityId(order)
  }

  order.traceabilityId = tid
  registerTraceabilityMapping(tid, { orderId: order.orderId || order.id, listingId: order.listingId })

  // Update in localStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const rawOrders = localStorage.getItem(BUYER_ORDERS_KEY)
      if (rawOrders) {
        const parsed = JSON.parse(rawOrders)
        const updated = parsed.map((o) =>
          (o.orderId === order.orderId || o.id === order.id) ? { ...o, traceabilityId: tid } : o
        )
        localStorage.setItem(BUYER_ORDERS_KEY, JSON.stringify(updated))
      }
    }
  } catch (e) {
    console.error('Error persisting order traceabilityId:', e)
  }

  return tid
}

/**
 * Get public URL for QR encoding
 */
export function getTraceabilityUrl(traceabilityId) {
  if (!traceabilityId) return ''
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/traceability/${traceabilityId}`
  }
  return `/traceability/${traceabilityId}`
}

/**
 * Generate QR code data URL (PNG data URL)
 */
export async function generateQrDataUrl(text, options = {}) {
  try {
    const opts = {
      width: 240,
      margin: 2,
      color: {
        dark: '#16321f', // Match platform theme deep green
        light: '#ffffff',
      },
      ...options,
    }
    return await QRCode.toDataURL(text, opts)
  } catch (err) {
    console.error('QR generation error:', err)
    return ''
  }
}

/**
 * Build complete, chronological farm-to-consumer journey data.
 * Pure deterministic derivation across localStorage records.
 * NEVER exposes sensitive credentials, passwords, or phone numbers.
 */
export function buildTraceabilityData(targetId) {
  if (!targetId || typeof targetId !== 'string') return null

  const cleanId = targetId.trim()

  let mappings = []
  let listings = []
  let orders = []
  let routes = []

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const rawMap = localStorage.getItem(TRACEABILITY_STORAGE_KEY)
      mappings = rawMap ? JSON.parse(rawMap) : []

      const rawListings = localStorage.getItem(FARMER_LISTINGS_KEY)
      listings = rawListings ? JSON.parse(rawListings) : []

      const rawOrders = localStorage.getItem(BUYER_ORDERS_KEY)
      orders = rawOrders ? JSON.parse(rawOrders) : []

      const rawRoutes = localStorage.getItem(ROUTES_KEY)
      routes = rawRoutes ? JSON.parse(rawRoutes) : []
    }
  } catch (e) {
    console.error('Error reading localStorage in buildTraceabilityData:', e)
  }

  // 1. Identify matched mapping, listing, and order
  const matchedMapping = mappings.find(
    (m) => m.traceabilityId === cleanId || m.listingId === cleanId || m.orderId === cleanId
  )

  let matchedListing = listings.find(
    (l) =>
      l.traceabilityId === cleanId ||
      l.id === cleanId ||
      (matchedMapping && l.id === matchedMapping.listingId)
  )

  let matchedOrder = orders.find(
    (o) =>
      o.traceabilityId === cleanId ||
      o.orderId === cleanId ||
      o.id === cleanId ||
      (matchedMapping && (o.orderId === matchedMapping.orderId || o.id === matchedMapping.orderId)) ||
      (matchedListing && o.listingId === matchedListing.id)
  )

  // If order was found first without listing, reverse-match the listing
  if (!matchedListing && matchedOrder?.listingId) {
    matchedListing = listings.find((l) => l.id === matchedOrder.listingId)
  }

  // If neither listing nor order exists, return null (404 Not Found)
  if (!matchedListing && !matchedOrder) {
    return null
  }

  const effectiveTraceabilityId =
    cleanId.startsWith('TRC-2026-')
      ? cleanId
      : matchedListing?.traceabilityId || matchedOrder?.traceabilityId || `TRC-2026-${cleanId.slice(-6).toUpperCase()}`

  const crop = matchedListing?.crop || matchedOrder?.crop || 'Crop'
  const displayCrop = crop.charAt(0).toUpperCase() + crop.slice(1)

  // 2. Hub Aggregation info
  const hubAggregations = getAllHubAggregations(listings)
  const hubLot = hubAggregations[crop.toLowerCase()]
  const isHubPickup =
    matchedListing?.pickupDecision?.method === 'HUB' ||
    matchedOrder?.pickupDecision?.method === 'HUB'

  // 3. Route Delivery stop info
  let matchedRouteStop = null
  let matchedRouteTotal = null
  if (routes && routes.length > 0) {
    for (const r of routes) {
      if (r.stops && Array.isArray(r.stops)) {
        const foundStop = r.stops.find(
          (s) =>
            (matchedOrder && s.buyerName === matchedOrder.buyerName) ||
            (matchedOrder && s.destination === matchedOrder.buyerLocation)
        )
        if (foundStop) {
          matchedRouteStop = foundStop
          matchedRouteTotal = {
            totalDistanceKm: r.totalDistanceKm,
            estimatedTotalMinutes: r.estimatedTotalMinutes,
            originHub: r.originHub,
          }
          break
        }
      }
    }
  }

  // 4. Construct strictly sanitized public stages
  return {
    traceabilityId: effectiveTraceabilityId,
    crop: displayCrop,
    cropKey: crop.toLowerCase(),
    quantityKg: matchedOrder?.quantityKg || matchedOrder?.quantity || matchedListing?.quantity || 0,
    unitPrice: matchedListing?.price ?? matchedListing?.expectedPrice ?? matchedOrder?.pricePerKg ?? 0,
    stages: {
      // 1. Farmer Listing
      farmerListing: matchedListing
        ? {
            isComplete: true,
            crop: displayCrop,
            farmerName: matchedListing.farmerName || 'Verified Regional Farmer',
            location: matchedListing.location || 'Local Farm',
            harvestDate: matchedListing.harvestDate || 'Fresh Harvest',
            listedAt: matchedListing.createdAt || null,
            quantityKg: matchedListing.quantity || 0,
            ratePerKg: matchedListing.price ?? matchedListing.expectedPrice ?? 0,
          }
        : {
            isComplete: true,
            crop: displayCrop,
            farmerName: matchedOrder?.farmerName || 'Verified Regional Farmer',
            location: matchedOrder?.farmerLocation || 'Local Farm',
            harvestDate: 'Harvest Record Logged',
            listedAt: matchedOrder?.createdAt || null,
            quantityKg: matchedOrder?.quantityKg || matchedOrder?.quantity || 0,
            ratePerKg: matchedOrder?.pricePerKg || 0,
          },

      // 2. AI Quality Inspection
      quality: (matchedListing?.quality || matchedOrder?.qualityGrade)
        ? {
            isComplete: true,
            grade: matchedListing?.quality?.grade || matchedOrder?.qualityGrade || 'B',
            score: matchedListing?.quality?.score ?? 85,
            confidence: matchedListing?.quality?.confidence ?? 0.9,
            observations: matchedListing?.quality?.observations || [
              'Fresh produce inspection completed',
              'Consistent color and physical texture',
            ],
            assessedAt: matchedListing?.quality?.assessedAt || matchedListing?.createdAt || null,
          }
        : {
            isComplete: false,
          },

      // 3. AI Fair Price Benchmark
      fairPrice: (matchedListing?.fairPrice || matchedOrder?.fairPrice)
        ? {
            isComplete: true,
            suggestedPrice:
              matchedListing?.fairPrice?.suggestedPrice || matchedOrder?.fairPrice || 35,
            minPrice: matchedListing?.fairPrice?.minPrice || Math.round((matchedListing?.fairPrice?.suggestedPrice || 35) * 0.9),
            maxPrice: matchedListing?.fairPrice?.maxPrice || Math.round((matchedListing?.fairPrice?.suggestedPrice || 35) * 1.1),
          }
        : {
            isComplete: false,
          },

      // 4. Smart Pickup Decision
      pickup: (matchedListing?.pickupDecision || matchedOrder?.pickupDecision)
        ? {
            isComplete: true,
            method: matchedListing?.pickupDecision?.method || matchedOrder?.pickupDecision?.method || 'HUB',
            thresholdKg: matchedListing?.pickupDecision?.thresholdKg || matchedOrder?.pickupDecision?.thresholdKg || 50,
            reason:
              matchedListing?.pickupDecision?.reason ||
              matchedOrder?.pickupDecision?.reason ||
              'Determined based on crop threshold rules',
          }
        : {
            isComplete: false,
          },

      // 5. Hub Aggregation
      hubAggregation: (isHubPickup && hubLot && hubLot.totalQuantityKg > 0)
        ? {
            isComplete: true,
            status: 'POOLED_AT_HUB',
            totalQuantityKg: hubLot.totalQuantityKg,
            farmerCount: hubLot.farmerCount,
            listingCount: hubLot.listingCount,
            averagePricePerKg: hubLot.averagePricePerKg,
            hubName: 'Local Aggregation Mandi Hub',
          }
        : {
            isComplete: false,
            status: isHubPickup ? 'ELIGIBLE' : 'NOT_ELIGIBLE',
            isEligible: isHubPickup,
          },

      // 6. Buyer Order
      buyerOrder: matchedOrder
        ? {
            isComplete: true,
            orderId: matchedOrder.orderId || matchedOrder.id,
            buyerName: matchedOrder.buyerName || 'Verified Buyer',
            buyerLocation: matchedOrder.buyerLocation || 'Buyer Destination',
            orderedQuantityKg: matchedOrder.quantityKg || matchedOrder.quantity || 0,
            totalAmount: matchedOrder.totalAmount || 0,
            orderedAt: matchedOrder.createdAt,
          }
        : {
            isComplete: false,
          },

      // 7. Route Optimization
      route: matchedRouteStop
        ? {
            isComplete: true,
            stopNumber: matchedRouteStop.stopNumber,
            destination: matchedRouteStop.destination || matchedRouteStop.deliveryLocation,
            legDistanceKm: matchedRouteStop.legDistanceKm || matchedRouteStop.distanceKm,
            cumulativeDistanceKm: matchedRouteStop.cumulativeDistanceKm || matchedRouteStop.distanceKm,
            estimatedMinutes: matchedRouteStop.estimatedMinutes,
            originHub: matchedRouteTotal?.originHub || 'Aggregation Hub',
          }
        : {
            isComplete: false,
          },
      routeOptimization: matchedRouteStop
        ? {
            isComplete: true,
            stopNumber: matchedRouteStop.stopNumber,
            destination: matchedRouteStop.destination || matchedRouteStop.deliveryLocation,
            distanceKm: matchedRouteStop.legDistanceKm || matchedRouteStop.distanceKm,
            legDistanceKm: matchedRouteStop.legDistanceKm || matchedRouteStop.distanceKm,
            cumulativeDistanceKm: matchedRouteStop.cumulativeDistanceKm || matchedRouteStop.distanceKm,
            estimatedMinutes: matchedRouteStop.estimatedMinutes,
            originHub: matchedRouteTotal?.originHub || 'Aggregation Hub',
          }
        : {
            isComplete: false,
          },

      // 8. Delivery Fulfillment
      delivery: matchedOrder
        ? {
            isComplete:
              matchedOrder.fulfillmentStatus === 'DELIVERED' ||
              matchedOrder.fulfillmentStatus === 'PAYMENT_RELEASED',
            status: matchedOrder.fulfillmentStatus || 'PAYMENT_SECURED',
            delivered:
              matchedOrder.fulfillmentStatus === 'DELIVERED' ||
              matchedOrder.fulfillmentStatus === 'PAYMENT_RELEASED',
            inTransit: matchedOrder.fulfillmentStatus === 'IN_TRANSIT',
          }
        : {
            isComplete: false,
          },

      // 9. Payment & Escrow Status
      payment: matchedOrder?.payment
        ? {
            isComplete: matchedOrder.payment.status === 'RELEASED',
            status: matchedOrder.payment.status, // "SECURED" | "RELEASED"
            paymentStatus: matchedOrder.payment.status,
            fulfillmentStatus: matchedOrder.fulfillmentStatus || 'PAYMENT_SECURED',
            amount: matchedOrder.payment.amount || matchedOrder.totalAmount,
            simulated: true,
          }
        : {
            isComplete: false,
          },
    },
  }
}

// auth.js - Unified Authentication & Data Service for SIH 2026 Prototype
// Architecture Update: Unified user accounts (Single user can both SELL and BUY).
// Preserves all legacy data in localStorage and provides backward compatibility.

const USERS_KEY = 'sih_users'
const USER_SESSION_KEY = 'sih_user_session'

// Legacy keys preserved for backward compatibility
const LEGACY_FARMER_ACCOUNTS_KEY = 'sih_farmer_accounts'
const LEGACY_FARMER_SESSION_KEY = 'sih_farmer_session'
const LEGACY_BUYER_SESSION_KEY = 'sih_buyer_session'
const FARMER_LISTINGS_KEY = 'sih_farmer_listings'
const BUYER_ORDERS_KEY = 'sih_buyer_orders'

import { normalizeOrder } from './paymentEscrow.js'
import { ensureOrderTraceabilityId } from './traceability.js'

// Demo-safe password hashing using native browser Web Crypto API (SHA-256)
export async function hashPassword(password) {
  if (!window.crypto || !window.crypto.subtle) {
    return btoa(unescape(encodeURIComponent(password)))
  }
  const msgUint8 = new TextEncoder().encode(password + '_sih_salt_2026')
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------
// LEGACY MIGRATION & BACKWARD COMPATIBILITY
// ---------------------------------------------------------
export function migrateLegacyData() {
  try {
    // 1. Safely migrate legacy farmer accounts into sih_users without deleting anything
    const rawFarmers = localStorage.getItem(LEGACY_FARMER_ACCOUNTS_KEY)
    const farmerAccounts = rawFarmers ? JSON.parse(rawFarmers) : []

    const rawUsers = localStorage.getItem(USERS_KEY)
    let users = rawUsers ? JSON.parse(rawUsers) : []

    let updatedUsers = false
    farmerAccounts.forEach((farmer) => {
      const exists = users.some(
        (u) => u.mobile === farmer.mobile || u.id === farmer.id
      )
      if (!exists) {
        users.push({
          id: farmer.id,
          name: farmer.name,
          mobile: farmer.mobile,
          location: farmer.location,
          passwordHash: farmer.passwordHash,
          createdAt: farmer.createdAt || new Date().toISOString(),
        })
        updatedUsers = true
      }
    })

    if (updatedUsers || !rawUsers) {
      localStorage.setItem(USERS_KEY, JSON.stringify(users))
    }

    // 2. Migrate active session if sih_user_session is not set but farmer session is
    const currentUserSession = localStorage.getItem(USER_SESSION_KEY)
    if (!currentUserSession) {
      const farmerSession = localStorage.getItem(LEGACY_FARMER_SESSION_KEY)
      if (farmerSession) {
        localStorage.setItem(USER_SESSION_KEY, farmerSession)
      }
    }
  } catch (e) {
    console.error('Error during legacy data migration:', e)
  }
}

// Run migration check immediately upon module evaluation
if (typeof window !== 'undefined' && window.localStorage) {
  migrateLegacyData()
}

// ---------------------------------------------------------
// UNIFIED USER ACCOUNT FUNCTIONS (Sell & Buy)
// ---------------------------------------------------------

// Get all stored unified users
export function getStoredUsers() {
  migrateLegacyData()
  try {
    const raw = localStorage.getItem(USERS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    console.error('Error reading unified users from localStorage:', e)
    return []
  }
}

// Save unified users array to localStorage
export function saveUsers(users) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users))
  } catch (e) {
    console.error('Error saving users to localStorage:', e)
  }
}

// Get the currently active unified user session
export function getCurrentUser() {
  migrateLegacyData()
  try {
    const raw = localStorage.getItem(USER_SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    console.error('Error reading user session from localStorage:', e)
    return null
  }
}

export const getCurrentUserSession = getCurrentUser

// Unified registration: creates a unified account with NO role constraint
export async function registerUser({ name, mobile, location, password }) {
  migrateLegacyData()
  const users = getStoredUsers()
  const cleanedMobile = mobile.trim()

  // Check duplicate mobile
  const exists = users.some((u) => u.mobile === cleanedMobile)
  if (exists) {
    return { success: false, error: 'duplicate_mobile' }
  }

  const passwordHash = await hashPassword(password)
  const newUser = {
    id: 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    name: name.trim(),
    mobile: cleanedMobile,
    location: location.trim(),
    passwordHash,
    createdAt: new Date().toISOString(),
  }

  users.push(newUser)
  saveUsers(users)

  // Start active unified session
  const session = {
    id: newUser.id,
    name: newUser.name,
    mobile: newUser.mobile,
    location: newUser.location,
    loginTime: new Date().toISOString(),
  }
  localStorage.setItem(USER_SESSION_KEY, JSON.stringify(session))
  // Keep legacy session synced
  localStorage.setItem(LEGACY_FARMER_SESSION_KEY, JSON.stringify(session))

  return { success: true, user: session }
}

// Unified login: authenticates against unified accounts
export async function loginUser({ mobile, password }) {
  migrateLegacyData()
  const users = getStoredUsers()
  const cleanedMobile = mobile.trim()
  const user = users.find((u) => u.mobile === cleanedMobile)

  if (!user) {
    return { success: false, error: 'invalid_credentials' }
  }

  const inputHash = await hashPassword(password)
  if (user.passwordHash !== inputHash) {
    return { success: false, error: 'invalid_credentials' }
  }

  // Create session (omitting password hash)
  const session = {
    id: user.id,
    name: user.name,
    mobile: user.mobile,
    location: user.location,
    loginTime: new Date().toISOString(),
  }
  localStorage.setItem(USER_SESSION_KEY, JSON.stringify(session))
  // Keep legacy session synced
  localStorage.setItem(LEGACY_FARMER_SESSION_KEY, JSON.stringify(session))

  return { success: true, user: session }
}

// Unified logout: clears active sessions
export function logoutUser() {
  try {
    localStorage.removeItem(USER_SESSION_KEY)
    localStorage.removeItem(LEGACY_FARMER_SESSION_KEY)
    localStorage.removeItem(LEGACY_BUYER_SESSION_KEY)
  } catch (e) {
    console.error('Error removing sessions:', e)
  }
}

// ---------------------------------------------------------
// COMBINED USER ACTIVITY HELPERS (Listings & Orders)
// ---------------------------------------------------------

// Retrieve listings created by this user
export function getUserListings(userId, userMobile) {
  try {
    const raw = localStorage.getItem(FARMER_LISTINGS_KEY)
    const all = raw ? JSON.parse(raw) : []
    if (!userId && !userMobile) return []
    return all.filter((item) => {
      if (userId && item.farmerId === userId) return true
      if (userMobile && item.farmerMobile === userMobile) return true
      return false
    })
  } catch (e) {
    console.error('Error reading user listings:', e)
    return []
  }
}

// Retrieve orders placed by this user
export function getUserOrders(userId, userMobile) {
  try {
    const raw = localStorage.getItem(BUYER_ORDERS_KEY)
    const all = raw ? JSON.parse(raw) : []
    if (!userId && !userMobile) return []
    return all.filter((order) => {
      if (userId && order.buyerId === userId) return true
      if (userMobile && order.buyerMobile === userMobile) return true
      return false
    })
  } catch (e) {
    console.error('Error reading user orders:', e)
    return []
  }
}

// ---------------------------------------------------------
// ORDER PLACEMENT (Inventory & Order Storage)
// ---------------------------------------------------------

// Get all orders from localStorage
export function getAllOrders() {
  try {
    const raw = localStorage.getItem(BUYER_ORDERS_KEY)
    const list = raw ? JSON.parse(raw) : []
    return list.map(normalizeOrder).filter(Boolean)
  } catch (e) {
    console.error('Error reading orders:', e)
    return []
  }
}

// Place an order: records order and updates available inventory in farmer listings
export function placeOrder({ listing, quantity, buyerSession }) {
  try {
    const orderQty = parseFloat(quantity)
    const unitPrice = parseFloat(listing.price ?? listing.expectedPrice ?? 0)
    const totalAmount = Math.round(orderQty * unitPrice * 100) / 100
    const orderId = 'ORD_' + Date.now().toString().slice(-6)

    const newOrder = {
      id: orderId,
      orderId,
      buyerId: buyerSession.id,
      buyerName: buyerSession.name,
      buyerMobile: buyerSession.mobile,
      buyerLocation: buyerSession.location,
      listingId: listing.id,
      crop: listing.crop,
      quantity: orderQty,
      quantityKg: orderQty,
      pricePerKg: unitPrice,
      ratePerKg: unitPrice,
      totalAmount,
      farmerLocation: listing.location,
      farmerId: listing.farmerId || 'demo_farmer',
      farmerName: listing.farmerName || 'Farmer',
      qualityGrade: listing.quality?.grade || null,
      fairPrice: listing.fairPrice?.suggestedPrice ?? null,
      pickupDecision: listing.pickupDecision ?? null,
      payment: {
        status: 'SECURED',
        amount: totalAmount,
        simulated: true,
      },
      fulfillmentStatus: 'PAYMENT_SECURED',
      status: 'Payment Secured',
      createdAt: new Date().toISOString(),
    }

    // Ensure stable traceability ID linked to this produce and order
    if (listing?.traceabilityId) {
      newOrder.traceabilityId = listing.traceabilityId
    }
    ensureOrderTraceabilityId(newOrder)

    // 1. Save to orders
    const orders = getAllOrders()
    orders.unshift(newOrder)
    localStorage.setItem(BUYER_ORDERS_KEY, JSON.stringify(orders))

    // 2. Update remaining quantity in farmer listings
    const rawListings = localStorage.getItem(FARMER_LISTINGS_KEY)
    if (rawListings) {
      const parsedListings = JSON.parse(rawListings)
      const updatedListings = parsedListings.map((item) => {
        if (item.id === listing.id) {
          const rem = Math.max(0, item.quantity - orderQty)
          return { ...item, quantity: rem }
        }
        return item
      })
      localStorage.setItem(FARMER_LISTINGS_KEY, JSON.stringify(updatedListings))
    }

    return { success: true, order: newOrder }
  } catch (e) {
    console.error('Error placing order:', e)
    return { success: false, error: e.message }
  }
}

// ---------------------------------------------------------
// BACKWARD-COMPATIBILITY EXPORT WRAPPERS
// ---------------------------------------------------------
export const getStoredAccounts = getStoredUsers
export const saveAccounts = saveUsers
export const getCurrentSession = getCurrentUser
export const registerFarmer = registerUser
export const loginFarmer = loginUser
export const logoutFarmer = logoutUser

export const getCurrentBuyerSession = getCurrentUser
export const getBuyerOrders = getUserOrders
export const logoutBuyer = logoutUser

export { getFarmerOrders, advanceOrderStatus, getOrderEscrowStats, normalizeOrder } from './paymentEscrow.js'


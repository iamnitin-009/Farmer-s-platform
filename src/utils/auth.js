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
import { calculateDeliveryPricing } from './deliveryPricing.js'

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

// Pre-configured default admin credentials for SIH Prototype
export const DEFAULT_ADMIN_ID = 'admin'
const DEFAULT_ADMIN_HASH = 'cabbf34cf45db912b2d9bc8035ceb1b5d82a62c208363149aa10ba5bab641f80' // SHA-256 for 'admin' with salt

const DEFAULT_ADMIN_USER = {
  id: 'admin',
  username: 'admin',
  name: 'System Administrator',
  mobile: 'admin',
  location: 'Central Mandi HQ',
  role: 'admin',
  status: 'active',
  passwordHash: DEFAULT_ADMIN_HASH,
  createdAt: '2026-01-01T00:00:00.000Z',
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
          role: 'farmer',
          status: 'active',
          passwordHash: farmer.passwordHash,
          createdAt: farmer.createdAt || new Date().toISOString(),
        })
        updatedUsers = true
      }
    })

    // Ensure default Admin user is present in sih_users
    const adminIndex = users.findIndex(
      (u) => u.id === 'admin' || u.username === 'admin' || u.mobile === 'admin'
    )
    if (adminIndex === -1) {
      users.unshift({ ...DEFAULT_ADMIN_USER })
      updatedUsers = true
    } else {
      let adminUpdated = false
      if (users[adminIndex].role !== 'admin') {
        users[adminIndex].role = 'admin'
        adminUpdated = true
      }
      if (!users[adminIndex].passwordHash) {
        users[adminIndex].passwordHash = DEFAULT_ADMIN_HASH
        adminUpdated = true
      }
      if (adminUpdated) updatedUsers = true
    }

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
// UNIFIED USER ACCOUNT FUNCTIONS (Sell & Buy & Admin)
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

// Update active user role in the current session (Farmer <-> Buyer toggle for unified accounts)
export function setActiveUserRole(newRole) {
  try {
    const raw = localStorage.getItem(USER_SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    // Non-admins cannot elevate themselves to admin
    if (newRole === 'admin') return session
    // Once admin, always admin
    if (session.role === 'admin') return session

    session.role = newRole === 'buyer' ? 'buyer' : 'farmer'
    localStorage.setItem(USER_SESSION_KEY, JSON.stringify(session))
    localStorage.setItem(LEGACY_FARMER_SESSION_KEY, JSON.stringify(session))
    return session
  } catch (e) {
    console.error('Error updating active user role:', e)
    return null
  }
}

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
    role: 'farmer', // default initial role for registered users
    status: 'active',
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
    role: newUser.role,
    loginTime: new Date().toISOString(),
  }
  localStorage.setItem(USER_SESSION_KEY, JSON.stringify(session))
  // Keep legacy session synced
  localStorage.setItem(LEGACY_FARMER_SESSION_KEY, JSON.stringify(session))

  return { success: true, user: session }
}

// Unified login: authenticates against unified accounts and default admin
export async function loginUser({ mobile, password }) {
  migrateLegacyData()
  const users = getStoredUsers()
  const cleanedIdentifier = (mobile || '').trim()

  // Match by mobile, id, or username (case-insensitive for admin)
  const user = users.find((u) => {
    if (!u) return false
    if (u.mobile && u.mobile.toLowerCase() === cleanedIdentifier.toLowerCase()) return true
    if (cleanedIdentifier.toLowerCase() === 'admin') {
      return u.id === 'admin' || u.username === 'admin' || u.mobile === 'admin'
    }
    return u.id === cleanedIdentifier || (u.username && u.username.toLowerCase() === cleanedIdentifier.toLowerCase())
  })

  if (!user) {
    return { success: false, error: 'invalid_credentials' }
  }

  if (user.status === 'suspended') {
    return { success: false, error: 'account_suspended' }
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
    role: user.role || 'farmer',
    loginTime: new Date().toISOString(),
  }

  // Request authoritative server session token
  try {
    const tokenResp = await fetch('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: user.id,
        role: user.role || 'farmer',
        name: user.name,
        mobile: user.mobile,
        passwordHash: user.passwordHash,
        password,
      }),
    })
    if (tokenResp.ok) {
      const tokenData = await tokenResp.json()
      if (tokenData.success && tokenData.token) {
        session.token = tokenData.token
      }
    }
  } catch (e) {
    console.warn('[auth] Could not obtain server session token:', e)
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
    const unique = Array.from(new Map(all.map((item) => [item.id, item])).values())
    return unique.filter((item) => {
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
    const productSubtotal = Math.round(orderQty * unitPrice * 100) / 100
    const dlv = calculateDeliveryPricing(productSubtotal, orderQty)
    const totalAmount = dlv.netPayable
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
      variety: listing.variety || 'Regular',
      quantity: orderQty,
      quantityKg: orderQty,
      pricePerKg: unitPrice,
      ratePerKg: unitPrice,
      productSubtotal,
      deliveryCharge: dlv.deliveryCharge,
      platformFee: dlv.platformFee,
      discount: dlv.discount,
      netPayable: dlv.netPayable,
      effectivePricePerKg: dlv.effectivePricePerKg,
      deliveryStatus: dlv.deliveryStatus,
      deliveryRuleVersion: dlv.deliveryRuleVersion,
      calculatedAt: dlv.calculatedAt,
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
// ADMIN PLATFORM MANAGEMENT & ANALYTICS HELPERS
// ---------------------------------------------------------

// Retrieve all users with platform activity stats
export function getAllUsers() {
  migrateLegacyData()
  const users = getStoredUsers()
  const listings = (() => {
    try {
      const raw = localStorage.getItem(FARMER_LISTINGS_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })()
  const orders = getAllOrders()

  return users.map((u) => {
    const userListings = listings.filter((l) => l.farmerId === u.id || l.farmerMobile === u.mobile)
    const userOrders = orders.filter((o) => o.buyerId === u.id || o.buyerMobile === u.mobile)
    const incomingSales = orders.filter((o) => o.farmerId === u.id || (o.farmerLocation && lMatchesFarmer(o, u)))

    return {
      id: u.id,
      name: u.name || 'User',
      mobile: u.mobile,
      location: u.location || 'India',
      role: u.role || 'farmer',
      status: u.status || 'active',
      createdAt: u.createdAt || new Date().toISOString(),
      listingsCount: userListings.length,
      ordersCount: userOrders.length,
      salesCount: incomingSales.length,
    }
  })
}

function lMatchesFarmer(order, user) {
  return order.farmerId === user.id || (user.mobile && order.farmerMobile === user.mobile)
}

// Update a user's account status (e.g. 'active' or 'suspended')
export function updateUserStatus(userId, status) {
  if (userId === 'admin') {
    return { success: false, error: 'Cannot suspend primary system administrator.' }
  }
  const users = getStoredUsers()
  const target = users.find((u) => u.id === userId)
  if (!target) {
    return { success: false, error: 'User not found.' }
  }
  target.status = status
  saveUsers(users)
  return { success: true, user: target }
}

// Update a user's platform role
export function updateUserRole(userId, newRole) {
  if (userId === 'admin') {
    return { success: false, error: 'Cannot change primary administrator role.' }
  }
  const users = getStoredUsers()
  const target = users.find((u) => u.id === userId)
  if (!target) {
    return { success: false, error: 'User not found.' }
  }
  target.role = newRole
  saveUsers(users)
  return { success: true, user: target }
}

// Update produce listing moderation status ('approved', 'flagged', 'rejected')
export function updateListingModeration(listingId, moderationStatus) {
  try {
    const raw = localStorage.getItem(FARMER_LISTINGS_KEY)
    if (!raw) return { success: false, error: 'No listings found' }
    const list = JSON.parse(raw)
    const idx = list.findIndex((item) => item.id === listingId)
    if (idx === -1) return { success: false, error: 'Listing not found' }

    list[idx].moderationStatus = moderationStatus
    localStorage.setItem(FARMER_LISTINGS_KEY, JSON.stringify(list))
    return { success: true, listing: list[idx] }
  } catch (e) {
    console.error('Error updating listing moderation:', e)
    return { success: false, error: e.message }
  }
}

// Delete listing as an Admin
export function deleteListingAdmin(listingId) {
  try {
    const raw = localStorage.getItem(FARMER_LISTINGS_KEY)
    if (!raw) return { success: false }
    const list = JSON.parse(raw)
    const filtered = list.filter((item) => item.id !== listingId)
    localStorage.setItem(FARMER_LISTINGS_KEY, JSON.stringify(filtered))
    return { success: true }
  } catch (e) {
    console.error('Error deleting listing:', e)
    return { success: false, error: e.message }
  }
}

// Retrieve comprehensive platform metrics
export function getPlatformStats() {
  const users = getAllUsers()
  const listings = (() => {
    try {
      const raw = localStorage.getItem(FARMER_LISTINGS_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })()
  const orders = getAllOrders()

  const farmers = users.filter((u) => u.role === 'farmer')
  const buyers = users.filter((u) => u.role === 'buyer')

  // Active listings = not rejected and quantity > 0
  const activeListings = listings.filter(
    (l) => l.moderationStatus !== 'rejected' && (l.quantity > 0 || l.quantityKg > 0)
  )

  const totalListedQty = activeListings.reduce((sum, l) => sum + (parseFloat(l.quantity ?? l.quantityKg) || 0), 0)
  const totalListedVal = activeListings.reduce((sum, l) => {
    const q = parseFloat(l.quantity ?? l.quantityKg) || 0
    const p = parseFloat(l.price ?? l.expectedPrice) || 0
    return sum + (q * p)
  }, 0)

  const totalGmv = orders.reduce((sum, o) => sum + (parseFloat(o.totalAmount) || 0), 0)
  const escrowSecured = orders
    .filter((o) => o.fulfillmentStatus !== 'PAYMENT_RELEASED')
    .reduce((sum, o) => sum + (parseFloat(o.totalAmount) || 0), 0)
  const escrowReleased = orders
    .filter((o) => o.fulfillmentStatus === 'PAYMENT_RELEASED')
    .reduce((sum, o) => sum + (parseFloat(o.totalAmount) || 0), 0)

  const activeDeliveries = orders.filter(
    (o) => o.fulfillmentStatus === 'PICKUP_SCHEDULED' || o.fulfillmentStatus === 'IN_TRANSIT'
  ).length

  // Real AI inspection metrics from listings
  const inspectedListings = listings.filter((l) => l.quality && typeof l.quality.qualityScore === 'number')
  const totalInspections = inspectedListings.length
  const avgQualityScore = totalInspections > 0
    ? Math.round(inspectedListings.reduce((s, l) => s + l.quality.qualityScore, 0) / totalInspections)
    : 0

  const gradeCounts = { A: 0, B: 0, C: 0 }
  inspectedListings.forEach((l) => {
    const g = l.quality?.grade
    if (g && gradeCounts[g] !== undefined) gradeCounts[g]++
  })

  return {
    totalUsers: users.length,
    totalFarmers: farmers.length,
    totalBuyers: buyers.length,
    totalListings: listings.length,
    activeListingsCount: activeListings.length,
    totalListedQtyKg: Math.round(totalListedQty * 10) / 10,
    totalListedValue: Math.round(totalListedVal),
    totalOrders: orders.length,
    totalGmv: Math.round(totalGmv),
    escrowSecured: Math.round(escrowSecured),
    escrowReleased: Math.round(escrowReleased),
    activeDeliveries,
    ai: {
      totalInspections,
      avgQualityScore,
      gradeCounts,
      supportedCropsCount: 6,
    },
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



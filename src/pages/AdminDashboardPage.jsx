import { useState, useMemo, useEffect } from 'react'
import { useLanguage } from '../context/LanguageContext.jsx'
import {
  getAllUsers,
  updateUserStatus,
  updateUserRole,
  updateListingModeration,
  deleteListingAdmin,
  getPlatformStats,
  getAllOrders,
  advanceOrderStatus,
} from '../utils/auth.js'
import { getAllHubAggregations } from '../utils/aggregation.js'
import { getTopDemandedCrops, getDemandBadgeStyle, fetchDemandPrediction } from '../utils/demandPrediction.js'
import { getGradeBadgeStyle } from '../utils/quality.js'
import { IconShield } from '../components/Icons.jsx'
import { PragatiSymbol } from '../components/PragatiLogo.jsx'
import { fetchListings, updateListing as apiUpdateListing, deleteListing as apiDeleteListing } from '../utils/listingService.js'

export default function AdminDashboardPage({ onNavigate, onLogout }) {
  const { lang } = useLanguage()

  // Active section tab: 'overview' | 'users' | 'listings' | 'orders' | 'logistics' | 'ai' | 'reports' | 'analytics'
  const [activeTab, setActiveTab] = useState('overview')

  // Search & Filter states
  const [userSearch, setUserSearch] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState('all') // 'all' | 'farmer' | 'buyer'
  const [listingSearch, setListingSearch] = useState('')
  const [listingCropFilter, setListingCropFilter] = useState('all')
  const [listingStatusFilter, setListingStatusFilter] = useState('all') // 'all' | 'approved' | 'flagged' | 'rejected'

  // Notification / toast message
  const [toastMsg, setToastMsg] = useState('')
  const showToast = (msg) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 4000)
  }

  // Version counter to trigger re-renders upon state mutations
  const [dataVersion, setDataVersion] = useState(0)
  const refreshData = () => setDataVersion((v) => v + 1)

  // Platform statistics
  const stats = useMemo(() => {
    return getPlatformStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion])

  // All Users
  const users = useMemo(() => {
    return getAllUsers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion])

  // All Listings
  const listings = useMemo(() => {
    try {
      const raw = localStorage.getItem('sih_farmer_listings')
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion])

  // Synchronize full listing catalog and orders from backend on mount
  useEffect(() => {
    let isMounted = true
    fetchListings({ role: 'admin' }, session)
      .then((serverItems) => {
        if (isMounted && Array.isArray(serverItems)) {
          refreshData()
        }
      })
      .catch(() => {})

    // Synchronize orders from backend
    const headers = { 'Content-Type': 'application/json' }
    if (session?.token) headers['Authorization'] = `Bearer ${session.token}`
    if (session?.id) headers['x-user-id'] = session.id
    if (session?.role) headers['x-user-role'] = session.role

    fetch('/api/orders', { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data?.success && Array.isArray(data.orders)) {
          try {
            localStorage.setItem('sih_buyer_orders', JSON.stringify(data.orders))
            refreshData()
          } catch {}
        }
      })
      .catch(() => {})

    return () => {
      isMounted = false
    }
  }, [session])

  // All Orders
  const orders = useMemo(() => {
    return getAllOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion])

  // Hub Aggregations
  const hubAggregations = useMemo(() => {
    return getAllHubAggregations(listings)
  }, [listings])

  // Top Demanded Crops with live backend synchronization
  const [apiDemands, setApiDemands] = useState(null)
  useEffect(() => {
    fetchDemandPrediction({ lang })
      .then((data) => {
        if (data?.predictions && Array.isArray(data.predictions)) {
          setApiDemands(data.predictions)
        }
      })
      .catch(() => {})
  }, [lang])

  const topDemands = useMemo(() => {
    return apiDemands || getTopDemandedCrops(6, { lang })
  }, [apiDemands, lang])

  // Filtered Users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (userRoleFilter !== 'all' && u.role !== userRoleFilter) return false
      if (!userSearch.trim()) return true
      const q = userSearch.toLowerCase()
      return (
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.mobile && u.mobile.toLowerCase().includes(q)) ||
        (u.location && u.location.toLowerCase().includes(q)) ||
        (u.id && u.id.toLowerCase().includes(q))
      )
    })
  }, [users, userRoleFilter, userSearch])

  // Filtered Listings
  const filteredListings = useMemo(() => {
    return listings.filter((item) => {
      if (listingCropFilter !== 'all' && item.crop?.toLowerCase() !== listingCropFilter.toLowerCase()) return false
      const modStatus = item.moderationStatus || 'approved'
      if (listingStatusFilter !== 'all' && modStatus !== listingStatusFilter) return false
      if (!listingSearch.trim()) return true
      const q = listingSearch.toLowerCase()
      return (
        (item.crop && item.crop.toLowerCase().includes(q)) ||
        (item.farmerName && item.farmerName.toLowerCase().includes(q)) ||
        (item.location && item.location.toLowerCase().includes(q)) ||
        (item.id && item.id.toLowerCase().includes(q))
      )
    })
  }, [listings, listingCropFilter, listingStatusFilter, listingSearch])

  // Flagged / Reported listings
  const flaggedListings = useMemo(() => {
    return listings.filter((l) => l.moderationStatus === 'flagged')
  }, [listings])

  // User Actions
  const handleToggleUserStatus = (user) => {
    const nextStatus = user.status === 'suspended' ? 'active' : 'suspended'
    const res = updateUserStatus(user.id, nextStatus)
    if (res.success) {
      showToast(`User ${user.name} is now ${nextStatus.toUpperCase()}`)
      refreshData()
    } else {
      showToast(`Action failed: ${res.error}`)
    }
  }

  const handleToggleUserRole = (user) => {
    const nextRole = user.role === 'farmer' ? 'buyer' : 'farmer'
    const res = updateUserRole(user.id, nextRole)
    if (res.success) {
      showToast(`Role for ${user.name} changed to ${nextRole.toUpperCase()}`)
      refreshData()
    } else {
      showToast(`Action failed: ${res.error}`)
    }
  }

  // Listing Actions
  const handleModerationChange = (listingId, newStatus) => {
    const res = updateListingModeration(listingId, newStatus)
    apiUpdateListing(listingId, { moderationStatus: newStatus }, { role: 'admin' }).catch(() => {})
    if (res.success) {
      showToast(`Listing ${listingId} set to ${newStatus.toUpperCase()}`)
      refreshData()
    } else {
      showToast('Error updating listing moderation')
    }
  }

  const handleDeleteListing = (listingId) => {
    if (window.confirm('Are you sure you want to remove this listing permanently?')) {
      const res = deleteListingAdmin(listingId)
      apiDeleteListing(listingId, { role: 'admin' }).catch(() => {})
      if (res.success) {
        showToast('Listing removed successfully')
        refreshData()
      }
    }
  }

  // Order Actions
  const handleAdvanceOrder = (orderId) => {
    const res = advanceOrderStatus(orderId)
    if (res.success) {
      showToast(`Order ${orderId} advanced to next fulfillment step`)
      refreshData()
    }
  }

  return (
    <div className="admin-page">
      {/* Top Banner / Control Center Header */}
      <div className="admin-top-bar">
        <div className="section-inner admin-nav-inner">
          <div className="admin-brand-wrap">
            <div className="admin-badge-icon" style={{ padding: '4px' }}>
              <PragatiSymbol size={32} />
            </div>
            <div>
              <div className="admin-title-row">
                <h1 className="admin-title">
                  PRAGATI Admin Console <span style={{ opacity: 0.8, fontSize: '0.85em', fontWeight: 500 }}>• Administration</span>
                </h1>
                <span className="admin-role-pill">🛡️ SYSTEM ADMIN</span>
              </div>
              <p className="admin-subtitle">
                Comprehensive supervision of Farmers, Buyers, Produce Lots, Escrow & AI Infrastructure
              </p>
            </div>
          </div>

          <div className="admin-top-actions">
            <button
              type="button"
              className="btn btn-outline admin-btn-logout"
              onClick={onLogout}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {toastMsg && (
        <div className="admin-toast-banner" role="alert">
          <span>✓ {toastMsg}</span>
        </div>
      )}

      <div className="section-inner admin-content">
        {/* ======================================================== */}
        {/* PLATFORM OVERVIEW KPI BAR */}
        {/* ======================================================== */}
        <section className="admin-kpi-grid">
          <div className="kpi-card kpi-card-farmers">
            <span className="kpi-label">Total Farmers</span>
            <span className="kpi-value">{stats.totalFarmers}</span>
            <span className="kpi-subtext">Registered Suppliers</span>
          </div>

          <div className="kpi-card kpi-card-buyers">
            <span className="kpi-label">Total Buyers</span>
            <span className="kpi-value">{stats.totalBuyers}</span>
            <span className="kpi-subtext">Active Demand Accounts</span>
          </div>

          <div className="kpi-card kpi-card-listings">
            <span className="kpi-label">Active Listings</span>
            <span className="kpi-value">{stats.activeListingsCount}</span>
            <span className="kpi-subtext">{stats.totalListedQtyKg} kg Total Volume</span>
          </div>

          <div className="kpi-card kpi-card-orders">
            <span className="kpi-label">Total Orders (GMV)</span>
            <span className="kpi-value">₹{stats.totalGmv.toLocaleString('en-IN')}</span>
            <span className="kpi-subtext">{stats.totalOrders} Orders Placed</span>
          </div>

          <div className="kpi-card kpi-card-escrow">
            <span className="kpi-label">Escrow Secured</span>
            <span className="kpi-value">₹{stats.escrowSecured.toLocaleString('en-IN')}</span>
            <span className="kpi-subtext">₹{stats.escrowReleased.toLocaleString('en-IN')} Released</span>
          </div>

          <div className="kpi-card kpi-card-logistics">
            <span className="kpi-label">Active Deliveries</span>
            <span className="kpi-value">{stats.activeDeliveries}</span>
            <span className="kpi-subtext">In Pickup / Transit</span>
          </div>
        </section>

        {/* ======================================================== */}
        {/* NAVIGATION TABS */}
        {/* ======================================================== */}
        <div className="admin-tabs-bar" role="tablist">
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            📊 Overview
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👥 Users ({users.length})
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'listings' ? 'active' : ''}`}
            onClick={() => setActiveTab('listings')}
          >
            🌾 Listings ({listings.length})
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'orders' ? 'active' : ''}`}
            onClick={() => setActiveTab('orders')}
          >
            🛒 Orders & Escrow ({orders.length})
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'logistics' ? 'active' : ''}`}
            onClick={() => setActiveTab('logistics')}
          >
            🚚 Logistics & Hubs
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            🤖 AI Monitoring
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'reports' ? 'active' : ''}`}
            onClick={() => setActiveTab('reports')}
          >
            ⚠️ Reports ({flaggedListings.length})
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            📈 Analytics
          </button>
        </div>

        {/* ======================================================== */}
        {/* TAB 1: OVERVIEW */}
        {/* ======================================================== */}
        {activeTab === 'overview' && (
          <div className="admin-tab-pane">
            <div className="admin-section-header">
              <h2>Real-Time Platform Activity & Health</h2>
              <p>Live snapshot of transactions, logistics operations, and automated AI assistance.</p>
            </div>

            <div className="admin-two-col-grid">
              {/* Left Column: Recent Activity Feed */}
              <div className="admin-card">
                <div className="admin-card-header">
                  <h3>Recent Marketplace Events</h3>
                </div>
                <div className="admin-activity-timeline">
                  {orders.length === 0 && listings.length === 0 ? (
                    <div className="admin-empty-state">No platform activity recorded yet.</div>
                  ) : (
                    <>
                      {orders.slice(0, 5).map((o) => (
                        <div key={o.id || o.orderId} className="timeline-item">
                          <span className="timeline-icon">🛒</span>
                          <div className="timeline-content">
                            <strong>Order #{o.orderId || o.id}</strong> — {o.buyerName || 'Buyer'} bought{' '}
                            {o.quantity || o.quantityKg}kg of {o.crop} (₹{o.totalAmount})
                            <span className="timeline-meta">Status: {o.status || o.fulfillmentStatus}</span>
                          </div>
                        </div>
                      ))}
                      {listings.slice(0, 5).map((l) => (
                        <div key={l.id} className="timeline-item">
                          <span className="timeline-icon">🌾</span>
                          <div className="timeline-content">
                            <strong>New Listing</strong> — {l.crop?.toUpperCase()} ({l.quantity}kg @ ₹{l.price ?? l.expectedPrice}/kg) by{' '}
                            {l.farmerName || 'Farmer'}
                            <span className="timeline-meta">Location: {l.location} | Grade: {l.quality?.grade || 'Ungraded'}</span>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>

              {/* Right Column: AI & System Pulse */}
              <div className="admin-card">
                <div className="admin-card-header">
                  <h3>AI & System Operational Status</h3>
                </div>
                <div className="admin-system-pulse">
                  <div className="pulse-row">
                    <span className="pulse-indicator online" />
                    <div>
                      <strong>Groq Vision Multimodal API</strong>
                      <div className="pulse-detail">Model: qwen/qwen3.6-27b | Status: Operational (Deterministic Grading)</div>
                    </div>
                  </div>

                  <div className="pulse-row">
                    <span className="pulse-indicator online" />
                    <div>
                      <strong>Automated Escrow & Payment Engine</strong>
                      <div className="pulse-detail">Status: Active | 100% Guaranteed 2-Sided Buyer-Farmer Settlement</div>
                    </div>
                  </div>

                  <div className="pulse-row">
                    <span className="pulse-indicator online" />
                    <div>
                      <strong>Smart Logistics & Hub Aggregator</strong>
                      <div className="pulse-detail">Nearest-Neighbor Route Optimization: Active</div>
                    </div>
                  </div>

                  <div className="pulse-row">
                    <span className="pulse-indicator online" />
                    <div>
                      <strong>Predictive Crop Demand Engine</strong>
                      <div className="pulse-detail">Crops Tracked: Rice, Wheat, Chana Dal, Toor Dal</div>
                    </div>
                  </div>
                </div>

                <div className="admin-quick-links-box">
                  <h4>Quick Platform Navigation</h4>
                  <div className="quick-btn-row">
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => onNavigate('/hub')}>
                      🚚 Hub Aggregation View
                    </button>
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => onNavigate('/logistics')}>
                      🗺️ Logistics Route View
                    </button>
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => onNavigate('/traceability')}>
                      🏷️ Product Traceability QR
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: USER MANAGEMENT */}
        {/* ======================================================== */}
        {activeTab === 'users' && (
          <div className="admin-tab-pane">
            <div className="admin-section-header">
              <h2>User Management ({filteredUsers.length} Users)</h2>
              <p>Supervise farmer suppliers and buyer accounts, check verification, and manage account statuses.</p>
            </div>

            <div className="admin-controls-row">
              <input
                type="text"
                placeholder="Search user by name, mobile, location..."
                className="admin-search-input"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />

              <div className="admin-filter-group">
                <label htmlFor="userRoleFilter">Role Filter:</label>
                <select
                  id="userRoleFilter"
                  className="admin-select"
                  value={userRoleFilter}
                  onChange={(e) => setUserRoleFilter(e.target.value)}
                >
                  <option value="all">All Roles</option>
                  <option value="farmer">Farmers Only</option>
                  <option value="buyer">Buyers Only</option>
                </select>
              </div>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User ID</th>
                    <th>Name</th>
                    <th>Contact / Mobile</th>
                    <th>Location</th>
                    <th>Platform Role</th>
                    <th>Status</th>
                    <th>Listings</th>
                    <th>Orders</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="text-center py-4">No matching users found.</td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u.id}>
                        <td><code>{u.id.substring(0, 10)}...</code></td>
                        <td><strong>{u.name}</strong></td>
                        <td>{u.mobile}</td>
                        <td>{u.location}</td>
                        <td>
                          <span className={`role-badge role-${u.role}`}>
                            {u.role === 'admin' ? '🛡️ Admin' : u.role === 'farmer' ? '🧑‍🌾 Farmer' : '🛒 Buyer'}
                          </span>
                        </td>
                        <td>
                          <span className={`status-badge status-${u.status}`}>
                            {u.status.toUpperCase()}
                          </span>
                        </td>
                        <td>{u.listingsCount}</td>
                        <td>{u.ordersCount}</td>
                        <td>
                          {u.id !== 'admin' && (
                            <div className="table-action-btns">
                              <button
                                type="button"
                                className={`btn-action-small ${u.status === 'suspended' ? 'btn-activate' : 'btn-suspend'}`}
                                onClick={() => handleToggleUserStatus(u)}
                              >
                                {u.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                              </button>
                              <button
                                type="button"
                                className="btn-action-small btn-role-swap"
                                onClick={() => handleToggleUserRole(u)}
                                title="Toggle Farmer / Buyer role"
                              >
                                Switch Role
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: LISTING MANAGEMENT */}
        {/* ======================================================== */}
        {activeTab === 'listings' && (
          <div className="admin-tab-pane">
            <div className="admin-section-header">
              <h2>Listing Management & Moderation ({filteredListings.length} Lots)</h2>
              <p>Inspect agricultural produce lots, verify Groq AI quality grading, and moderate marketplace content.</p>
            </div>

            <div className="admin-controls-row">
              <input
                type="text"
                placeholder="Search listing by crop, farmer name, location..."
                className="admin-search-input"
                value={listingSearch}
                onChange={(e) => setListingSearch(e.target.value)}
              />

              <div className="admin-filter-group">
                <label htmlFor="listingCropFilter">Crop:</label>
                <select
                  id="listingCropFilter"
                  className="admin-select"
                  value={listingCropFilter}
                  onChange={(e) => setListingCropFilter(e.target.value)}
                >
                  <option value="all">All Crops</option>
                  <option value="rice">Rice</option>
                  <option value="wheat">Wheat</option>
                  <option value="chana_dal">Chana Dal</option>
                  <option value="toor_dal">Toor Dal</option>
                </select>
              </div>

              <div className="admin-filter-group">
                <label htmlFor="listingStatusFilter">Status:</label>
                <select
                  id="listingStatusFilter"
                  className="admin-select"
                  value={listingStatusFilter}
                  onChange={(e) => setListingStatusFilter(e.target.value)}
                >
                  <option value="all">All Moderation Statuses</option>
                  <option value="approved">Approved (Active)</option>
                  <option value="flagged">Flagged for Review</option>
                  <option value="rejected">Rejected (Hidden)</option>
                </select>
              </div>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Crop</th>
                    <th>Available Qty</th>
                    <th>Price</th>
                    <th>Farmer</th>
                    <th>Location</th>
                    <th>AI Grade</th>
                    <th>Moderation</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredListings.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="text-center py-4">No produce listings found.</td>
                    </tr>
                  ) : (
                    filteredListings.map((item) => {
                      const modStatus = item.moderationStatus || 'approved'
                      const gradeStyle = getGradeBadgeStyle(item.quality?.grade)
                      return (
                        <tr key={item.id}>
                          <td><code>{item.id}</code></td>
                          <td><strong>{item.crop?.toUpperCase()}</strong></td>
                          <td>{item.quantity} kg</td>
                          <td>₹{item.price ?? item.expectedPrice} / kg</td>
                          <td>{item.farmerName || 'Farmer'}</td>
                          <td>{item.location}</td>
                          <td>
                            {item.quality?.grade ? (
                              <span
                                className="grade-badge"
                                style={{
                                  backgroundColor: gradeStyle.bg,
                                  color: gradeStyle.color,
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  fontSize: '0.78rem',
                                  fontWeight: 'bold',
                                }}
                              >
                                Grade {item.quality.grade} ({item.quality.qualityScore}%)
                              </span>
                            ) : (
                              <span className="text-muted">Ungraded</span>
                            )}
                          </td>
                          <td>
                            <span className={`moderation-pill mod-${modStatus}`}>
                              {modStatus.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <div className="table-action-btns">
                              {modStatus !== 'approved' && (
                                <button
                                  type="button"
                                  className="btn-action-small btn-approve"
                                  onClick={() => handleModerationChange(item.id, 'approved')}
                                >
                                  Approve
                                </button>
                              )}
                              {modStatus !== 'flagged' && (
                                <button
                                  type="button"
                                  className="btn-action-small btn-flag"
                                  onClick={() => handleModerationChange(item.id, 'flagged')}
                                >
                                  Flag
                                </button>
                              )}
                              {modStatus !== 'rejected' && (
                                <button
                                  type="button"
                                  className="btn-action-small btn-reject"
                                  onClick={() => handleModerationChange(item.id, 'rejected')}
                                >
                                  Reject
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn-action-small btn-delete"
                                onClick={() => handleDeleteListing(item.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 4: ORDERS & ESCROW */}
        {/* ======================================================== */}
        {activeTab === 'orders' && (
          <div className="admin-tab-pane">
            <div className="admin-section-header">
              <h2>Orders & Escrow Financial Supervision ({orders.length} Orders)</h2>
              <p>Oversee trade volume, escrow allocations, verification checks, and transit milestones.</p>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Date</th>
                    <th>Crop & Qty</th>
                    <th>Total Amount</th>
                    <th>Buyer</th>
                    <th>Farmer</th>
                    <th>Escrow Status</th>
                    <th>Fulfillment Milestone</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="text-center py-4">No marketplace orders placed yet.</td>
                    </tr>
                  ) : (
                    orders.map((o) => (
                      <tr key={o.id || o.orderId}>
                        <td><code>{o.orderId || o.id}</code></td>
                        <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                        <td><strong>{o.crop}</strong> ({o.quantity || o.quantityKg} kg)</td>
                        <td><strong>₹{o.totalAmount?.toLocaleString('en-IN')}</strong></td>
                        <td>{o.buyerName || 'Buyer'}</td>
                        <td>{o.farmerName || 'Farmer'}</td>
                        <td>
                          <span className={`escrow-pill escrow-${(o.payment?.status || 'secured').toLowerCase()}`}>
                            {o.payment?.status || 'SECURED'}
                          </span>
                        </td>
                        <td>
                          <span className="fulfillment-step-tag">
                            {o.fulfillmentStatus || o.status}
                          </span>
                        </td>
                        <td>
                          {o.fulfillmentStatus !== 'PAYMENT_RELEASED' && (
                            <button
                              type="button"
                              className="btn-action-small btn-advance"
                              onClick={() => handleAdvanceOrder(o.id || o.orderId)}
                            >
                              Advance Step →
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 5: LOGISTICS & HUBS */}
        {/* ======================================================== */}
        {activeTab === 'logistics' && (
          <div className="admin-tab-pane">
            <div className="admin-section-header">
              <h2>Hub Aggregation & Smart Logistics Overview</h2>
              <p>Monitor aggregated micro-lots, truckload capacities, and pickup distribution.</p>
            </div>

            <div className="hub-overview-cards-grid">
              {Object.keys(hubAggregations).map((crop) => {
                const hub = hubAggregations[crop]
                return (
                  <div key={crop} className="hub-summary-card">
                    <div className="hub-card-top">
                      <h3>{crop.toUpperCase()} Hub Batch</h3>
                      <span className="hub-weight-badge">{hub.totalQuantityKg} kg</span>
                    </div>
                    <div className="hub-details">
                      <div><strong>Contributors:</strong> {hub.contributors.length} Farmers</div>
                      <div><strong>Weighted Rate:</strong> ₹{hub.weightedAveragePrice.toFixed(2)}/kg</div>
                      <div><strong>Total Batch Value:</strong> ₹{Math.round(hub.totalBatchValue)}</div>
                      <div><strong>Progress to Truckload:</strong> {hub.truckLoadPercent}%</div>
                    </div>
                    <div className="hub-progress-track">
                      <div className="hub-progress-fill" style={{ width: `${Math.min(100, hub.truckLoadPercent)}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 6: AI MONITORING */}
        {/* ======================================================== */}
        {activeTab === 'ai' && (
          <div className="admin-tab-pane">
            <div className="admin-section-header">
              <h2>AI Intelligence & Model Activity</h2>
              <p>Auditable operational metrics from Groq multimodal inspections and deterministic algorithms.</p>
            </div>

            <div className="admin-ai-grid">
              <div className="ai-stat-card">
                <h3>AI Quality Checks Performed</h3>
                <span className="ai-big-number">{stats.ai.totalInspections}</span>
                <p>Produce lots visually analyzed by Groq Vision Multimodal API.</p>
              </div>

              <div className="ai-stat-card">
                <h3>Average Produce Quality</h3>
                <span className="ai-big-number">{stats.ai.avgQualityScore}%</span>
                <p>Mean visual freshness score across all inspected agricultural lots.</p>
              </div>

              <div className="ai-stat-card">
                <h3>Quality Grade Distribution</h3>
                <div className="grade-distribution-bars">
                  <div className="dist-row">
                    <span>Grade A (Premium &ge; 90%)</span>
                    <strong>{stats.ai.gradeCounts.A} lots</strong>
                  </div>
                  <div className="dist-row">
                    <span>Grade B (Good Commercial &ge; 75%)</span>
                    <strong>{stats.ai.gradeCounts.B} lots</strong>
                  </div>
                  <div className="dist-row">
                    <span>Grade C (Fair &lt; 75%)</span>
                    <strong>{stats.ai.gradeCounts.C} lots</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="admin-card mt-4">
              <div className="admin-card-header">
                <h3>7-Day Crop Demand Forecast Engine</h3>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Crop</th>
                      <th>Demand Level</th>
                      <th>Predicted (7 Days)</th>
                      <th>Confidence</th>
                      <th>Market Outlook</th>
                      <th>Suggested Farmer Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topDemands.map((item) => {
                      const badge = getDemandBadgeStyle(item.demandLevel)
                      const predVol = item.predictedDemand || item.predictedDemandKg || 0
                      return (
                        <tr key={item.cropKey || item.crop}>
                          <td><strong>{item.crop}</strong></td>
                          <td>
                            <span
                              style={{
                                backgroundColor: badge.bg,
                                color: badge.color,
                                padding: '3px 8px',
                                borderRadius: '4px',
                                fontSize: '0.8rem',
                                fontWeight: 'bold',
                              }}
                            >
                              {badge.labelEn || item.demandLevel}
                            </span>
                          </td>
                          <td><strong>{predVol.toLocaleString()} kg</strong></td>
                          <td><strong>{item.confidence}%</strong></td>
                          <td>
                            {item.explanation}
                            {item.dataSource === 'baseline_estimate' && (
                              <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>
                                (Baseline estimate)
                              </span>
                            )}
                          </td>
                          <td>{item.recommendation}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 7: REPORTS & MODERATION */}
        {/* ======================================================== */}
        {activeTab === 'reports' && (
          <div className="admin-tab-pane">
            <div className="admin-section-header">
              <h2>Reports & Content Moderation</h2>
              <p>Platform integrity alerts, suspicious listings, and disputes requiring administrator intervention.</p>
            </div>

            {flaggedListings.length === 0 ? (
              <div className="admin-empty-card">
                <span className="empty-icon">✅</span>
                <h3>No Flagged Listings or Active Disputes</h3>
                <p>All current produce lots meet platform quality and pricing guidelines.</p>
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Listing ID</th>
                      <th>Crop</th>
                      <th>Farmer</th>
                      <th>Flag Reason</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flaggedListings.map((l) => (
                      <tr key={l.id}>
                        <td><code>{l.id}</code></td>
                        <td><strong>{l.crop}</strong> ({l.quantity}kg)</td>
                        <td>{l.farmerName || 'Farmer'}</td>
                        <td><span className="flag-reason-tag">Marked for Administrator Review</span></td>
                        <td>
                          <div className="table-action-btns">
                            <button
                              type="button"
                              className="btn-action-small btn-approve"
                              onClick={() => handleModerationChange(l.id, 'approved')}
                            >
                              Clear & Approve
                            </button>
                            <button
                              type="button"
                              className="btn-action-small btn-delete"
                              onClick={() => handleDeleteListing(l.id)}
                            >
                              Remove Lot
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 8: ANALYTICS */}
        {/* ======================================================== */}
        {activeTab === 'analytics' && (
          <div className="admin-tab-pane">
            <div className="admin-section-header">
              <h2>Platform Analytics & Regional Distribution</h2>
              <p>Macro-level metrics across user adoption, market liquidity, and trade volume.</p>
            </div>

            <div className="admin-analytics-grid">
              <div className="analytics-card">
                <h3>Supply vs. Demand Distribution</h3>
                <div className="analytics-stat-row">
                  <span>Registered Farmers</span>
                  <strong>{stats.totalFarmers} ({stats.totalUsers > 0 ? Math.round((stats.totalFarmers / stats.totalUsers) * 100) : 0}%)</strong>
                </div>
                <div className="analytics-stat-row">
                  <span>Registered Buyers</span>
                  <strong>{stats.totalBuyers} ({stats.totalUsers > 0 ? Math.round((stats.totalBuyers / stats.totalUsers) * 100) : 0}%)</strong>
                </div>
                <div className="analytics-stat-row">
                  <span>Total Gross Merchandise Value</span>
                  <strong>₹{stats.totalGmv.toLocaleString('en-IN')}</strong>
                </div>
              </div>

              <div className="analytics-card">
                <h3>Produce Liquidity & Inventory</h3>
                <div className="analytics-stat-row">
                  <span>Total Available Produce</span>
                  <strong>{stats.totalListedQtyKg} kg</strong>
                </div>
                <div className="analytics-stat-row">
                  <span>Total Listed Value</span>
                  <strong>₹{stats.totalListedValue.toLocaleString('en-IN')}</strong>
                </div>
                <div className="analytics-stat-row">
                  <span>Avg Price per kg</span>
                  <strong>
                    ₹
                    {stats.totalListedQtyKg > 0
                      ? (stats.totalListedValue / stats.totalListedQtyKg).toFixed(2)
                      : '0.00'}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useMemo, useEffect } from 'react'
import { useLanguage } from '../context/LanguageContext.jsx'
import {
  getUserOrders,
  placeOrder,
  advanceOrderStatus,
} from '../utils/auth.js'
import {
  getStepIndex,
} from '../utils/paymentEscrow.js'
import { IconSprout, IconPin, IconTag, IconLeaf } from '../components/Icons.jsx'
import { getGradeBadgeStyle } from '../utils/quality.js'
import { isEligibleForHubListing, getAggregatedCropTotal } from '../utils/aggregation.js'
import { ensureListingTraceabilityId, generateQrDataUrl, getTraceabilityUrl } from '../utils/traceability.js'
import { predictCropDemand, getDemandBadgeStyle } from '../utils/demandPrediction.js'
import { fetchListings, updateListing as apiUpdateListing } from '../utils/listingService.js'

const CROP_KEYS = ['wheat', 'rice', 'potato', 'onion', 'tomato', 'fruits']

function EscrowTimeline({ fulfillmentStatus, t }) {
  const steps = [
    { key: 'PAYMENT_SECURED', label: t.stepPaymentSecured || 'Payment Secured', icon: '🔒' },
    { key: 'VERIFICATION_PENDING', label: t.stepVerification || 'Verification', icon: '⚖️' },
    { key: 'PICKUP_SCHEDULED', label: t.stepPickup || 'Pickup', icon: '📅' },
    { key: 'IN_TRANSIT', label: t.stepInTransit || 'In Transit', icon: '🚚' },
    { key: 'DELIVERED', label: t.stepDelivered || 'Delivered', icon: '📦' },
    { key: 'PAYMENT_RELEASED', label: t.stepPaymentReleased || 'Payment Released', icon: '💰' },
  ]

  const currentIdx = getStepIndex(fulfillmentStatus)

  return (
    <div className="escrow-stepper-wrap">
      <div className="escrow-stepper">
        {steps.map((step, idx) => {
          const isDone = idx < currentIdx
          const isCurrent = idx === currentIdx
          let circleClass = 'step-circle'
          if (isDone) circleClass += ' done'
          else if (isCurrent) circleClass += ' current'
          else circleClass += ' pending'

          return (
            <div key={step.key} className={`escrow-step-col ${isCurrent ? 'active-col' : ''}`}>
              <div className="step-node">
                <div className={circleClass} title={step.label}>
                  {isDone ? '✓' : step.icon}
                </div>
                {idx < steps.length - 1 && (
                  <div className={`step-connector ${idx < currentIdx ? 'done' : ''}`} />
                )}
              </div>
              <span className={`step-label ${isCurrent ? 'current-label' : ''}`}>
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function BuyerMarketplacePage({ onNavigate, session }) {
  const { t, lang } = useLanguage()
  const mktT = t.buyerMarketplace
  const farmerPortalT = t.farmerPortal
  const qT = t.qualityCheck || {}
  const fpT = t.fairPrice || {}
  const pkT = t.pickupDecision || {}
  const aggT = t.hubAggregation || {}
  const escrowT = t.paymentEscrow || {}
  const trT = t.traceability || {}
  const dpT = t.demandPrediction || {}

  // Active view tab: 'marketplace' or 'my-orders'
  const [activeTab, setActiveTab] = useState('marketplace')

  // Raw listings read directly from localStorage ('sih_farmer_listings')
  const [listings, setListings] = useState(() => {
    try {
      const raw = localStorage.getItem('sih_farmer_listings')
      const parsed = raw ? JSON.parse(raw) : []
      let changed = false
      const migrated = parsed.map((item) => {
        let updated = item
        if (!updated.traceabilityId) {
          ensureListingTraceabilityId(updated)
          changed = true
        }
        return updated
      })
      if (changed) {
        localStorage.setItem('sih_farmer_listings', JSON.stringify(migrated))
      }
      return migrated
    } catch {
      return []
    }
  })

  // Fetch shared listings from backend upon mount and when session updates
  useEffect(() => {
    let isMounted = true
    fetchListings({ role: 'buyer' }, session)
      .then((serverItems) => {
        if (isMounted && Array.isArray(serverItems) && serverItems.length > 0) {
          setListings(serverItems)
        }
      })
      .catch(() => {})
    return () => {
      isMounted = false
    }
  }, [session])

  // Refresh listings from backend with local fallback
  const refreshListings = async () => {
    try {
      const serverItems = await fetchListings({ role: 'buyer' }, session)
      if (Array.isArray(serverItems)) {
        setListings(serverItems)
        return
      }
    } catch {}
    try {
      const raw = localStorage.getItem('sih_farmer_listings')
      setListings(raw ? JSON.parse(raw) : [])
    } catch {
      setListings([])
    }
  }

  // QR Code Preview Modal state
  const [qrModalData, setQrModalData] = useState(null)
  const [copiedLink, setCopiedLink] = useState(false)

  const handleOpenQrModal = async (itemOrOrder) => {
    const tid = itemOrOrder.traceabilityId || itemOrOrder.id || itemOrOrder.orderId
    const url = getTraceabilityUrl(tid)
    const dataUrl = await generateQrDataUrl(url)
    setQrModalData({
      traceabilityId: tid,
      crop: itemOrOrder.crop,
      title: farmerPortalT.crops[itemOrOrder.crop] || itemOrOrder.crop,
      url,
      qrDataUrl: dataUrl,
    })
    setCopiedLink(false)
  }

  const handleCopyQrLink = () => {
    if (qrModalData?.url) {
      navigator.clipboard?.writeText(qrModalData.url)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2500)
    }
  }

  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCrop, setSelectedCrop] = useState('all')
  const [locationFilter, setLocationFilter] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [minQuantity, setMinQuantity] = useState('')

  // Modal states
  const [selectedListing, setSelectedListing] = useState(null)
  const [orderingListing, setOrderingListing] = useState(null)
  const [orderQuantity, setOrderQuantity] = useState('')
  const [orderError, setOrderError] = useState('')
  const [orderSuccess, setOrderSuccess] = useState(null)
  const [isPlacingOrder, setIsPlacingOrder] = useState(false)

  // Orders for current unified user
  const [buyerOrders, setBuyerOrders] = useState(() => {
    return session?.id ? getUserOrders(session.id, session.mobile) : []
  })

  // Filtered produce listings
  const filteredListings = useMemo(() => {
    return listings.filter((item) => {
      // Must have remaining stock
      if (!item.quantity || item.quantity <= 0) return false

      // Crop filter
      if (selectedCrop !== 'all' && item.crop !== selectedCrop) {
        return false
      }

      // Location filter
      if (locationFilter.trim()) {
        const itemLoc = (item.location || '').toLowerCase()
        if (!itemLoc.includes(locationFilter.trim().toLowerCase())) {
          return false
        }
      }

      // Price range filter
      const itemPrice = typeof item.price === 'number' ? item.price : parseFloat(item.price ?? item.expectedPrice ?? 0)
      if (minPrice && itemPrice < parseFloat(minPrice)) return false
      if (maxPrice && itemPrice > parseFloat(maxPrice)) return false

      // Min quantity filter
      if (minQuantity && item.quantity < parseFloat(minQuantity)) return false

      // Keyword search (crop name or location)
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase()
        const cropName = (farmerPortalT.crops[item.crop] || item.crop).toLowerCase()
        const loc = (item.location || '').toLowerCase()
        if (!cropName.includes(q) && !loc.includes(q) && !item.crop.toLowerCase().includes(q)) {
          return false
        }
      }

      return true
    })
  }, [listings, selectedCrop, locationFilter, minPrice, maxPrice, minQuantity, searchQuery, farmerPortalT.crops])

  // Reset filters
  const handleResetFilters = () => {
    setSearchQuery('')
    setSelectedCrop('all')
    setLocationFilter('')
    setMinPrice('')
    setMaxPrice('')
    setMinQuantity('')
  }

  // Open Order Modal
  const handleOpenOrder = (item) => {
    setOrderingListing(item)
    setOrderQuantity(Math.min(item.quantity, 100).toString())
    setOrderError('')
  }

  // Advance simulated escrow order status
  const handleAdvanceOrder = (orderId) => {
    const res = advanceOrderStatus(orderId)
    if (res.success) {
      if (session?.id) {
        setBuyerOrders(getUserOrders(session.id, session.mobile))
      }
    }
  }

  // Submit Order
  const handleConfirmOrder = (e) => {
    e.preventDefault()
    setOrderError('')

    const qty = parseFloat(orderQuantity)
    if (!orderQuantity || isNaN(qty) || qty <= 0) {
      setOrderError(mktT.validation.qtyPositive)
      return
    }

    if (qty > orderingListing.quantity) {
      setOrderError(mktT.validation.qtyExceeded.replace('{max}', orderingListing.quantity))
      return
    }

    setIsPlacingOrder(true)

    const result = placeOrder({
      listing: orderingListing,
      quantity: qty,
      buyerSession: session || { id: 'user_fallback', name: 'Verified User' },
    })

    setIsPlacingOrder(false)

    if (result.success) {
      const rem = Math.max(0, orderingListing.quantity - qty)
      apiUpdateListing(orderingListing.id, { quantity: rem, action: 'order_decrement' }, session).catch(() => {})
      fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.order),
      }).catch(() => {})
      setOrderSuccess(result.order)
      setOrderingListing(null)
      if (session?.id) {
        setBuyerOrders(getUserOrders(session.id, session.mobile))
      }
      refreshListings()
    } else {
      setOrderError(result.error || 'Failed to place order')
    }
  }

  return (
    <div className="buyer-marketplace-page">
      {/* Top Navigation Bar */}
      <div className="farmer-portal-top">
        <div className="section-inner farmer-nav-inner">
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              className="btn-back-home btn-back-dash"
              type="button"
              onClick={() => onNavigate('/dashboard')}
              style={{ fontWeight: '600' }}
            >
              ← {t.dashboard?.backToDashboard || 'Dashboard'}
            </button>
            <button
              className="btn-back-home"
              type="button"
              onClick={() => onNavigate('/')}
            >
              {mktT.backToHome}
            </button>
          </div>

          <div className="buyer-session-indicator">
            <div className="buyer-profile-info">
              <span className="buyer-name-label">
                👤 <strong>{session?.name || 'User'}</strong>
                {session?.mobile && (
                  <span style={{ fontWeight: 'normal', color: 'var(--text-muted)', marginLeft: '6px' }}>
                    ({session.mobile})
                  </span>
                )}
              </span>
              {session?.location && (
                <span
                  className="buyer-location-badge"
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    marginLeft: '8px',
                  }}
                >
                  <IconPin /> {session.location}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="section-inner buyer-main-container">
        {/* Page Header */}
        <header className="buyer-page-header">
          <div className="buyer-header-title-row">
            <div>
              <h1>{mktT.title}</h1>
              <p className="section-subheading">{mktT.subtitle}</p>
            </div>

            {/* View Switcher Tabs */}
            <div className="marketplace-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'marketplace'}
                className={`mkt-tab ${activeTab === 'marketplace' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('marketplace')}
              >
                {mktT.tabMarketplace} ({filteredListings.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'my-orders'}
                className={`mkt-tab ${activeTab === 'my-orders' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('my-orders')}
              >
                {mktT.tabMyOrders} ({buyerOrders.length})
              </button>
            </div>
          </div>
        </header>

        {/* Order Success Banner */}
        {orderSuccess && (
          <div className="alert-success" role="alert">
            <div className="alert-success-icon">✓</div>
            <div className="alert-success-content">
              <h4>{mktT.orderSuccessHeading}</h4>
              <p>
                {mktT.orderSuccessMessage} <strong>#{orderSuccess.id}</strong> ({orderSuccess.quantity} kg of{' '}
                {farmerPortalT.crops[orderSuccess.crop] || orderSuccess.crop} for ₹
                {orderSuccess.totalAmount.toLocaleString('en-IN')})
              </p>
            </div>
            <button
              className="alert-close-btn"
              type="button"
              onClick={() => setOrderSuccess(null)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 1: BROWSE PRODUCE MARKETPLACE */}
        {/* ======================================================== */}
        {activeTab === 'marketplace' && (
          <div className="marketplace-layout">
            {/* Search Bar */}
            <div className="marketplace-search-bar">
              <div className="search-input-wrap">
                <span className="search-icon">🔍</span>
                <input
                  type="text"
                  placeholder={mktT.searchPlaceholder}
                  className="search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="btn-clear-search"
                    onClick={() => setSearchQuery('')}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* Filter Panel */}
            <div className="marketplace-filter-card">
              <div className="filter-header">
                <span className="filter-title">{mktT.filterHeading}</span>
                <button
                  type="button"
                  className="btn-reset-filters"
                  onClick={handleResetFilters}
                >
                  {mktT.resetFilters}
                </button>
              </div>

              <div className="filter-grid">
                {/* Crop Filter */}
                <div className="filter-item">
                  <label className="filter-label">{farmerPortalT.cropLabel}</label>
                  <select
                    className="filter-select"
                    value={selectedCrop}
                    onChange={(e) => setSelectedCrop(e.target.value)}
                  >
                    <option value="all">{mktT.allCrops}</option>
                    {CROP_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {farmerPortalT.crops[key]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Location Filter */}
                <div className="filter-item">
                  <label className="filter-label">{mktT.filterLocation}</label>
                  <input
                    type="text"
                    placeholder={mktT.filterLocationPlaceholder}
                    className="filter-input"
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                  />
                </div>

                {/* Min Price */}
                <div className="filter-item">
                  <label className="filter-label">{mktT.filterMinPrice}</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 15"
                    className="filter-input"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                  />
                </div>

                {/* Max Price */}
                <div className="filter-item">
                  <label className="filter-label">{mktT.filterMaxPrice}</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 50"
                    className="filter-input"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                  />
                </div>

                {/* Min Quantity */}
                <div className="filter-item">
                  <label className="filter-label">{mktT.filterMinQty}</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 100"
                    className="filter-input"
                    value={minQuantity}
                    onChange={(e) => setMinQuantity(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Produce Grid */}
            <div className="produce-catalog-section">
              <div className="catalog-meta-row">
                <span className="results-count">
                  <strong>{filteredListings.length}</strong> {mktT.availableListingsCount}
                </span>
              </div>

              {listings.length === 0 ? (
                /* Empty state when no farmer has listed anything in localStorage */
                <div className="empty-state-card">
                  <div className="empty-state-icon">
                    <IconSprout width="44" height="44" />
                  </div>
                  <h3>{mktT.emptyMarketplaceTitle}</h3>
                  <p>{mktT.emptyMarketplaceSubtitle}</p>
                </div>
              ) : filteredListings.length === 0 ? (
                /* Empty state when filters return no match */
                <div className="empty-state-card">
                  <div className="empty-state-icon">🔍</div>
                  <h3>{mktT.noListingsFound}</h3>
                  <p>{mktT.noListingsSubtitle}</p>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={handleResetFilters}
                    style={{ marginTop: '12px' }}
                  >
                    {mktT.resetFilters}
                  </button>
                </div>
              ) : (
                /* Produce Cards Grid */
                <div className="produce-grid">
                  {filteredListings.map((item) => {
                    const cropName = farmerPortalT.crops[item.crop] || item.crop
                    const unitPrice = item.price ?? item.expectedPrice ?? 0
                    const estValue = (item.quantity * unitPrice).toLocaleString('en-IN')

                    return (
                      <div className="produce-card" key={item.id}>
                        {item.photo ? (
                          <div className="produce-img-wrap">
                            <img src={item.photo} alt={cropName} className="produce-img" />
                            <span className="produce-status-tag">
                              ● {mktT.listedStatus}
                            </span>
                          </div>
                        ) : (
                          <div className="produce-no-img-wrap">
                            <div className="produce-crop-avatar">
                              <IconSprout width="28" height="28" />
                            </div>
                            <span className="produce-status-tag">
                              ● {mktT.listedStatus}
                            </span>
                          </div>
                        )}

                        <div className="produce-card-body">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <h3 className="produce-title" style={{ margin: 0 }}>{cropName}</h3>
                            {item.traceabilityId && (
                              <span className="traceability-card-chip" title="Traceability ID">
                                🏷️ <code>{item.traceabilityId}</code>
                              </span>
                            )}
                          </div>
                          {item.quality?.grade && (
                            <div
                              className="produce-quality-tag"
                              style={{
                                backgroundColor: getGradeBadgeStyle(item.quality.grade).bg,
                                color: getGradeBadgeStyle(item.quality.grade).color,
                                border: `1px solid ${getGradeBadgeStyle(item.quality.grade).border}`,
                                marginBottom: '8px',
                              }}
                            >
                              ● {qT[`grade${item.quality.grade}`] || `Grade ${item.quality.grade}`} ({item.quality.score}/100)
                            </div>
                          )}
                          {item.fairPrice?.suggestedPrice && (
                            <div className="fair-price-card-badge" style={{ marginBottom: '8px' }}>
                              <span>⚖️</span>
                              <span>{fpT.fairRate || 'Fair Price'}: ₹{item.fairPrice.suggestedPrice}/kg</span>
                            </div>
                          )}
                          {item.pickupDecision && item.pickupDecision.method && (
                            <div className={`pickup-card-badge ${item.pickupDecision.method === 'HUB' ? 'hub' : 'home'}`} style={{ marginBottom: '8px' }}>
                              <span>{item.pickupDecision.method === 'HUB' ? '🚚' : '🚜'}</span>
                              <span>
                                {item.pickupDecision.method === 'HUB'
                                  ? (pkT.hubBadge || 'Hub Pickup')
                                  : (pkT.homeBadge || 'Farm Pickup')}
                              </span>
                            </div>
                          )}
                          {isEligibleForHubListing(item) && (
                            <div className="hub-aggregated-card-badge" style={{ marginBottom: '8px' }}>
                              <span>🚚</span>
                              <span>
                                {aggT.availableAsHubLot || 'Available as Aggregated Hub Lot'} ({getAggregatedCropTotal(listings, item.crop)} kg)
                              </span>
                            </div>
                          )}

                          {(() => {
                            const demandPred = predictCropDemand({ crop: item.crop, lang })
                            if (!demandPred || demandPred.cropKey === 'unknown') return null
                            const bStyle = getDemandBadgeStyle(demandPred.demandLevel)
                            return (
                              <div
                                className="produce-demand-pill"
                                style={{
                                  backgroundColor: bStyle.bg,
                                  color: bStyle.color,
                                  border: `1px solid ${bStyle.border}`,
                                  marginBottom: '8px',
                                }}
                              >
                                <span style={{ color: bStyle.dot, marginRight: '4px' }}>●</span>
                                <span>
                                  {demandPred.demandLevel === 'HIGH'
                                    ? (dpT.highDemand || 'High Demand')
                                    : demandPred.demandLevel === 'MEDIUM'
                                      ? (dpT.mediumDemand || 'Medium Demand')
                                      : (dpT.lowDemand || 'Low Demand')}
                                </span>
                                {demandPred.predictedDemandKg > 0 && (
                                  <span className="demand-qty-sub"> ({demandPred.predictedDemand || demandPred.predictedDemandKg} kg/7d)</span>
                                )}
                              </div>
                            )
                          })()}
                          <div className="produce-metrics-row">
                            <div className="produce-metric">
                              <span className="p-metric-label">{mktT.availableQty}</span>
                              <span className="p-metric-val">{item.quantity} kg</span>
                            </div>
                            <div className="produce-metric">
                              <span className="p-metric-label">{farmerPortalT.priceLabel}</span>
                              <span className="p-metric-val price-highlight">
                                ₹{unitPrice} {mktT.perKg}
                              </span>
                            </div>
                          </div>

                          <div className="produce-meta-list">
                            <div className="p-meta-item">
                              <IconPin width="14" height="14" />
                              <span>{item.location}</span>
                            </div>
                            <div className="p-meta-item">
                              <IconTag width="14" height="14" />
                              <span>{mktT.harvestDate}: {item.harvestDate}</span>
                            </div>
                            <div className="p-meta-item">
                              <span style={{ fontSize: '0.8rem', color: 'var(--green-mid)', fontWeight: '600' }}>
                                {mktT.lotTotalValue}: ₹{estValue}
                              </span>
                            </div>
                          </div>

                          <div className="produce-actions-row">
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => setSelectedListing(item)}
                            >
                              {mktT.btnViewDetails}
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => handleOpenOrder(item)}
                            >
                              {mktT.btnPlaceOrder}
                            </button>
                          </div>

                          <div className="produce-tr-row">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline btn-tr-view"
                              onClick={() => onNavigate && onNavigate(`/traceability/${item.traceabilityId || item.id}`)}
                              title={trT.viewTimeline || 'View Traceability'}
                            >
                              <span>🏷️</span>
                              <span>{trT.navTitle || 'Traceability'}</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline btn-tr-qr"
                              onClick={() => handleOpenQrModal(item)}
                              title={trT.qrTitle || 'Show QR Code'}
                            >
                              <span>📱</span>
                              <span>{trT.qrTitle || 'QR'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: MY ORDERS (ISOLATED TO CURRENT BUYER) */}
        {/* ======================================================== */}
        {activeTab === 'my-orders' && (
          <div className="my-orders-section">
            <div className="orders-header">
              <div>
                <h2>{mktT.myOrdersHeading}</h2>
                <p className="section-subheading">{mktT.myOrdersSubheading}</p>
              </div>
              <span className="orders-count-badge">
                {buyerOrders.length} {mktT.ordersCount}
              </span>
            </div>

            {buyerOrders.length === 0 ? (
              <div className="empty-state-card">
                <div className="empty-state-icon">
                  <IconLeaf width="42" height="42" />
                </div>
                <h3>{mktT.noOrdersTitle}</h3>
                <p>{mktT.noOrdersSubtitle}</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setActiveTab('marketplace')}
                  style={{ marginTop: '14px' }}
                >
                  {mktT.tabMarketplace}
                </button>
              </div>
            ) : (
              <div className="orders-list">
                {buyerOrders.map((order) => {
                  const cropName = farmerPortalT.crops[order.crop] || order.crop
                  const orderDate = new Date(order.createdAt).toLocaleDateString()

                  return (
                    <div className="order-card" key={order.id}>
                      <div className="order-card-top">
                        <div className="order-id-block">
                          <span className="order-label">{mktT.orderId}</span>
                          <span className="order-id-val">#{order.orderId || order.id}</span>
                          {order.traceabilityId && (
                            <span className="order-tr-pill" style={{ marginLeft: '8px', fontSize: '0.78rem', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '2px 7px', borderRadius: '12px' }}>
                              🏷️ {order.traceabilityId}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span className={`order-status-badge ${order.fulfillmentStatus === 'PAYMENT_RELEASED' ? 'status-released' : 'status-secured'}`}>
                            {order.fulfillmentStatus === 'PAYMENT_RELEASED'
                              ? `✅ ${escrowT.paymentReleasedToFarmer || 'Payment Released'}`
                              : order.fulfillmentStatus === 'DELIVERED'
                              ? `📦 ${escrowT.delivered || 'Delivered'}`
                              : order.fulfillmentStatus === 'IN_TRANSIT'
                              ? `🚚 ${escrowT.inTransit || 'In Transit'}`
                              : order.fulfillmentStatus === 'PICKUP_SCHEDULED'
                              ? `📅 ${escrowT.pickupScheduled || 'Pickup Scheduled'}`
                              : order.fulfillmentStatus === 'VERIFICATION_PENDING'
                              ? `⚖️ ${escrowT.verificationPending || 'Verification Pending'}`
                              : `🔒 ${escrowT.paymentSecured || 'Payment Secured'}`}
                          </span>
                        </div>
                      </div>

                      {/* Escrow Status Callout */}
                      <div className={`escrow-status-callout ${order.payment?.status === 'RELEASED' ? 'released' : 'secured'}`}>
                        <div className="escrow-callout-left">
                          <span className="escrow-lock-icon">{order.payment?.status === 'RELEASED' ? '💰' : '🔒'}</span>
                          <div>
                            <span className="escrow-callout-amount">₹{(order.totalAmount || 0).toLocaleString('en-IN')}</span>
                            <span className="escrow-callout-label">
                              {order.payment?.status === 'RELEASED'
                                ? (escrowT.paymentReleasedToFarmer || 'Payment Released to Farmer')
                                : (escrowT.securedBadge || 'Secured in Escrow')}
                            </span>
                          </div>
                        </div>
                        <span className="escrow-demo-pill">{escrowT.simulatedEscrow || 'Simulated Escrow'}</span>
                      </div>

                      {/* Visual 6-step Progress Timeline */}
                      <EscrowTimeline fulfillmentStatus={order.fulfillmentStatus} t={escrowT} />

                      <div className="order-card-body">
                        <div className="order-crop-info">
                          <div className="order-avatar">
                            <IconSprout width="22" height="22" />
                          </div>
                          <div>
                            <h4 className="order-crop-title">{cropName}</h4>
                            <span className="order-date-text">{mktT.placedOn} {orderDate}</span>
                          </div>
                        </div>

                        <div className="order-metrics-grid">
                          <div className="order-metric">
                            <span className="om-label">{mktT.orderQty}</span>
                            <span className="om-val">{order.quantity} kg</span>
                          </div>
                          <div className="order-metric">
                            <span className="om-label">{mktT.orderPrice}</span>
                            <span className="om-val">₹{order.pricePerKg} {mktT.perKg}</span>
                          </div>
                          <div className="order-metric highlight">
                            <span className="om-label">{mktT.orderTotal}</span>
                            <span className="om-val total">
                              ₹{order.totalAmount.toLocaleString('en-IN')}
                            </span>
                          </div>
                        </div>

                        <div className="order-footer-loc">
                          <IconPin width="14" height="14" />
                          <span>{mktT.orderLocation}: <strong>{order.farmerLocation}</strong></span>
                        </div>

                        {/* Order Traceability Actions */}
                        <div className="order-tr-row" style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            🏷️ <code>{order.traceabilityId || 'TRC-2026-PENDING'}</code>
                          </span>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline btn-tr-view"
                              onClick={() => onNavigate && onNavigate(`/traceability/${order.traceabilityId || order.orderId || order.id}`)}
                            >
                              <span>🏷️</span>
                              <span>{trT.trackProduce || 'Track Journey'} →</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline btn-tr-qr"
                              onClick={() => handleOpenQrModal(order)}
                            >
                              <span>📱</span>
                              <span>{trT.qrTitle || 'Show QR'}</span>
                            </button>
                          </div>
                        </div>

                        {/* Order Advancement Controls */}
                        <div className="order-escrow-actions">
                          {order.fulfillmentStatus !== 'PAYMENT_RELEASED' ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline btn-advance-order"
                              onClick={() => handleAdvanceOrder(order.orderId || order.id)}
                            >
                              <span>⚡ {escrowT.advanceStatus || 'Advance Status (Demo)'} →</span>
                            </button>
                          ) : (
                            <span className="order-completed-tag">
                              🎉 {escrowT.orderCompleted || 'Order Completed — Funds Released'}
                            </span>
                          )}
                          <span className="demo-subtext-note">
                            {escrowT.demoNotice || 'Demo Payment — No Real Money Transferred'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* MODAL 1: VIEW DETAILS MODAL */}
      {/* ======================================================== */}
      {selectedListing && (
        <div className="modal-backdrop" onClick={() => setSelectedListing(null)}>
          <div
            className="modal-card modal-produce-detail"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-detail-header">
              <h3>{mktT.modalDetailsHeading}</h3>
              <button
                type="button"
                className="modal-close-icon"
                onClick={() => setSelectedListing(null)}
              >
                ×
              </button>
            </div>

            {selectedListing.photo && (
              <img
                src={selectedListing.photo}
                alt="Produce lot"
                className="modal-produce-img"
              />
            )}

            <div className="modal-detail-content">
              <h2 className="modal-crop-name">
                {farmerPortalT.crops[selectedListing.crop] || selectedListing.crop}
              </h2>

              <div className="detail-facts-grid">
                <div className="fact-item">
                  <span className="fact-label">{mktT.availableQty}</span>
                  <span className="fact-val">{selectedListing.quantity} kg</span>
                </div>
                <div className="fact-item">
                  <span className="fact-label">{farmerPortalT.priceLabel}</span>
                  <span className="fact-val">₹{selectedListing.price ?? selectedListing.expectedPrice} {mktT.perKg}</span>
                </div>
                <div className="fact-item">
                  <span className="fact-label">{mktT.lotTotalValue}</span>
                  <span className="fact-val">
                    ₹{(selectedListing.quantity * (selectedListing.price ?? selectedListing.expectedPrice ?? 0)).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="fact-item">
                  <span className="fact-label">{mktT.harvestDate}</span>
                  <span className="fact-val">{selectedListing.harvestDate}</span>
                </div>
              </div>

              <div className="detail-loc-box">
                <IconPin width="16" height="16" />
                <span>{mktT.farmerLocation}: <strong>{selectedListing.location}</strong></span>
              </div>

              {/* Quality Assessment Breakdown */}
              {selectedListing.quality ? (
                <div className="modal-quality-section">
                  <div className="modal-quality-header">
                    <span
                      className="produce-quality-tag"
                      style={{
                        backgroundColor: getGradeBadgeStyle(selectedListing.quality.grade).bg,
                        color: getGradeBadgeStyle(selectedListing.quality.grade).color,
                        border: `1px solid ${getGradeBadgeStyle(selectedListing.quality.grade).border}`,
                        fontSize: '0.85rem',
                        padding: '4px 10px',
                      }}
                    >
                      ● {qT[`grade${selectedListing.quality.grade}`] || `Grade ${selectedListing.quality.grade}`} ({selectedListing.quality.score}/100)
                    </span>
                    <span className="quality-confidence-tag">
                      {qT.confidence || 'Confidence'}: {Math.round((selectedListing.quality.confidence || 0) * 100)}%
                    </span>
                  </div>
                  {selectedListing.quality.observations && selectedListing.quality.observations.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <span className="obs-title">{qT.observations || 'AI Observations'}:</span>
                      <ul className="obs-list">
                        {selectedListing.quality.observations.map((obs, idx) => (
                          <li key={idx} className="obs-item">
                            <span className="obs-bullet">✓</span>
                            <span>{obs}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div style={{ marginTop: '8px', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    {qT.modelAttribution || 'Assessed by Google Gemini Vision'}
                  </div>
                </div>
              ) : (
                <div style={{ margin: '12px 0', fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  ℹ️ {qT.unassessedNotice || 'No AI quality score available for this listing lot.'}
                </div>
              )}

              {/* AI Fair Market Benchmark Section */}
              {selectedListing.fairPrice && (() => {
                const asking = selectedListing.price ?? selectedListing.expectedPrice ?? 0
                const fair = selectedListing.fairPrice.suggestedPrice
                const min = selectedListing.fairPrice.minPrice
                const max = selectedListing.fairPrice.maxPrice

                let badgeClass = 'fair'
                let badgeText = fpT.withinRange || 'Fair market rate'
                if (asking > max) {
                  badgeClass = 'above'
                  badgeText = fpT.aboveRange || 'Above market benchmark'
                } else if (asking < min) {
                  badgeClass = 'deal'
                  badgeText = fpT.belowRange || 'Competitive buyer deal'
                }

                return (
                  <div className="modal-benchmark-section">
                    <div className="modal-benchmark-header">
                      <span className="benchmark-title">✨ {fpT.fairBenchmark || 'Fair Market Benchmark'}</span>
                      <span className={`benchmark-badge ${badgeClass}`}>
                        {badgeText}
                      </span>
                    </div>

                    <div className="benchmark-grid">
                      <div className="benchmark-item">
                        <div className="benchmark-item-label">{fpT.farmerPrice || 'Farmer Asking Rate'}</div>
                        <div className="benchmark-item-val">₹{asking}/kg</div>
                      </div>
                      <div className="benchmark-item">
                        <div className="benchmark-item-label">{fpT.fairRate || 'Fair Price'}</div>
                        <div className="benchmark-item-val">₹{fair}/kg</div>
                        <div className="benchmark-item-range">{fpT.marketRange || 'Range'}: ₹{min} - ₹{max}/kg</div>
                      </div>
                    </div>

                    <div style={{ marginTop: '8px', fontSize: '0.78rem', color: '#15803d' }}>
                      {fpT.explanationSummary || 'Calculated deterministically based on crop mandi baseline, AI quality grade, and lot volume.'}
                    </div>
                  </div>
                )
              })()}

              {/* Logistics & Smart Pickup Decision Breakdown */}
              {selectedListing.pickupDecision && selectedListing.pickupDecision.method && (
                <div className={`modal-pickup-section ${selectedListing.pickupDecision.method === 'HUB' ? 'hub' : 'home'}`}>
                  <div className="modal-pickup-header">
                    <span className="pickup-title">
                      {selectedListing.pickupDecision.method === 'HUB'
                        ? '🚚 ' + (pkT.hubTitle || 'Hub Pickup Recommended')
                        : '🚜 ' + (pkT.homeTitle || 'Home/Farm Pickup Recommended')}
                    </span>
                    <span className={`pickup-status-tag ${selectedListing.pickupDecision.method === 'HUB' ? 'hub' : 'home'}`}>
                      {selectedListing.pickupDecision.method === 'HUB' ? (pkT.hubShort || 'HUB') : (pkT.homeShort || 'FARM')}
                    </span>
                  </div>
                  <div className="pickup-reason-text">
                    {selectedListing.pickupDecision.reason}
                  </div>
                  <div className="pickup-threshold-meta">
                    {pkT.thresholdNote
                      ? pkT.thresholdNote.replace('{threshold}', selectedListing.pickupDecision.thresholdKg)
                      : `Hub collection threshold: ${selectedListing.pickupDecision.thresholdKg} kg`}
                  </div>
                </div>
              )}

              {/* Hub Aggregation Status Banner */}
              {isEligibleForHubListing(selectedListing) && (
                <div className="modal-hub-agg-notice">
                  <div className="mhan-title">
                    <span>🚚</span>
                    <strong>{aggT.availableAsHubLot || 'Available as Aggregated Hub Lot'}</strong>
                  </div>
                  <div className="mhan-desc">
                    {getAggregatedCropTotal(listings, selectedListing.crop)} kg {aggT.totalAggregatedQty || 'total aggregated'} at local mandi hub across multiple local farmers.
                  </div>
                </div>
              )}

              {/* Traceability Callout in View Details Modal */}
              <div className="modal-traceability-callout">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.3rem' }}>🏷️</span>
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.9rem' }}>{trT.title || 'Product Traceability'}</strong>
                      <code style={{ fontSize: '0.8rem', color: '#166534', background: '#dcfce7', padding: '1px 6px', borderRadius: '4px' }}>
                        {selectedListing.traceabilityId || 'TRC-2026-PENDING'}
                      </code>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => {
                        const item = selectedListing
                        setSelectedListing(null)
                        onNavigate && onNavigate(`/traceability/${item.traceabilityId || item.id}`)
                      }}
                    >
                      {trT.viewTimeline || 'Inspect Journey'} →
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => handleOpenQrModal(selectedListing)}
                    >
                      📱 {trT.qrTitle || 'Show QR'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setSelectedListing(null)}
                >
                  {farmerPortalT.backToHome ? 'Close' : 'Close'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const item = selectedListing
                    setSelectedListing(null)
                    handleOpenOrder(item)
                  }}
                >
                  {mktT.btnPlaceOrder}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: PLACE ORDER MODAL */}
      {/* ======================================================== */}
      {orderingListing && (
        <div className="modal-backdrop" onClick={() => setOrderingListing(null)}>
          <div
            className="modal-card modal-order-card"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-detail-header">
              <h3>{mktT.modalOrderHeading}</h3>
              <button
                type="button"
                className="modal-close-icon"
                onClick={() => setOrderingListing(null)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleConfirmOrder} className="order-form" noValidate>
              <div className="order-produce-summary">
                <h4>
                  {farmerPortalT.crops[orderingListing.crop] || orderingListing.crop}
                </h4>
                <div className="summary-meta">
                  <span>{mktT.availableQty}: <strong>{orderingListing.quantity} kg</strong></span>
                  <span>Rate: <strong>₹{orderingListing.price ?? orderingListing.expectedPrice} {mktT.perKg}</strong></span>
                </div>
              </div>

              {/* Quantity Input */}
              <div className="form-group">
                <label htmlFor="orderQtyInput" className="form-label">
                  {mktT.orderQuantityLabel} <span className="req">*</span>
                </label>
                <input
                  id="orderQtyInput"
                  type="number"
                  min="1"
                  max={orderingListing.quantity}
                  step="any"
                  placeholder={mktT.orderQuantityPlaceholder}
                  className={`form-input ${orderError ? 'input-error' : ''}`}
                  value={orderQuantity}
                  onChange={(e) => {
                    setOrderQuantity(e.target.value)
                    if (orderError) setOrderError('')
                  }}
                />
                {orderError && <span className="form-error">{orderError}</span>}
              </div>

              {/* Live Order Calculation Box */}
              <div className="live-order-calc">
                <div className="calc-row">
                  <span>{escrowT.crop || mktT.orderCrop}:</span>
                  <strong>{farmerPortalT.crops[orderingListing.crop] || orderingListing.crop}</strong>
                </div>
                <div className="calc-row">
                  <span>{escrowT.quantity || mktT.orderQty}:</span>
                  <strong>{orderQuantity || 0} kg</strong>
                </div>
                <div className="calc-row">
                  <span>{escrowT.rate || mktT.orderPrice}:</span>
                  <strong>₹{orderingListing.price ?? orderingListing.expectedPrice} {mktT.perKg}</strong>
                </div>
                {orderingListing.quality?.grade && (
                  <div className="calc-row">
                    <span>{escrowT.qualityGrade || 'Quality Grade'}:</span>
                    <strong style={{ color: getGradeBadgeStyle(orderingListing.quality.grade).color }}>
                      Grade {orderingListing.quality.grade} ({orderingListing.quality.score}/100)
                    </strong>
                  </div>
                )}
                {orderingListing.fairPrice?.suggestedPrice && (
                  <div className="calc-row">
                    <span>{escrowT.fairPriceBenchmark || 'Fair Price Benchmark'}:</span>
                    <strong style={{ color: '#15803d' }}>
                      ₹{orderingListing.fairPrice.suggestedPrice}/kg
                    </strong>
                  </div>
                )}
                {orderingListing.pickupDecision?.method && (
                  <div className="calc-row">
                    <span>{escrowT.pickupMethod || 'Pickup Method'}:</span>
                    <strong>
                      {orderingListing.pickupDecision.method === 'HUB'
                        ? '🚚 ' + (pkT.hubBadge || 'Hub Pickup')
                        : '🚜 ' + (pkT.homeBadge || 'Farm Pickup')}
                    </strong>
                  </div>
                )}
                <div className="calc-row total-row">
                  <span>{escrowT.total || mktT.orderTotal}:</span>
                  <span className="total-amount">
                    ₹{((parseFloat(orderQuantity) || 0) * (orderingListing.price ?? orderingListing.expectedPrice ?? 0)).toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              {/* Escrow Guarantee Notice */}
              <div className="escrow-modal-notice">
                <span className="escrow-notice-icon">🔒</span>
                <div>
                  <strong>{escrowT.simulatedEscrow || 'Simulated Escrow'}:</strong>{' '}
                  <span>
                    ₹{((parseFloat(orderQuantity) || 0) * (orderingListing.price ?? orderingListing.expectedPrice ?? 0)).toLocaleString('en-IN')}{' '}
                    {escrowT.escrowNotice || 'will be held securely in demo escrow and released to the farmer only upon delivery verification.'}
                  </span>
                </div>
              </div>

              {/* Demo Disclaimer */}
              <div className="order-demo-disclaimer">
                <span className="info-icon">ℹ</span>
                <span>{mktT.orderDisclaimer}</span>
              </div>

              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setOrderingListing(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isPlacingOrder}
                >
                  {isPlacingOrder ? mktT.submittingOrder : (escrowT.btnConfirmSecure || 'Confirm Order & Secure Payment')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 3: PRODUCE TRACEABILITY QR MODAL */}
      {/* ======================================================== */}
      {qrModalData && (
        <div className="modal-backdrop tr-qr-modal-backdrop" onClick={() => setQrModalData(null)}>
          <div className="modal-card tr-qr-modal-card" role="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-detail-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.4rem' }}>🏷️</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem' }}>{trT.qrTitle || 'Produce Traceability QR'}</h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{qrModalData.title}</span>
                </div>
              </div>
              <button type="button" className="modal-close-icon" onClick={() => setQrModalData(null)}>×</button>
            </div>

            <div className="tr-qr-modal-body">
              <div className="tr-qr-code-box">
                {qrModalData.qrDataUrl ? (
                  <img src={qrModalData.qrDataUrl} alt={`QR Code for ${qrModalData.traceabilityId}`} className="tr-qr-img" />
                ) : (
                  <div className="tr-qr-skeleton">Generating QR...</div>
                )}
              </div>

              <div className="tr-qr-code-meta">
                <span className="tr-qr-id-label">{trT.traceabilityId || 'Traceability ID'}:</span>
                <code className="tr-qr-id-code">{qrModalData.traceabilityId}</code>
              </div>

              <p className="tr-qr-modal-desc">
                {trT.qrScanHint || 'Scan with any smartphone camera or QR scanner to inspect the transparent farm-to-consumer journey.'}
              </p>

              <div className="tr-qr-url-box">
                <input type="text" readOnly value={qrModalData.url} className="form-input tr-qr-url-input" />
                <button type="button" className="btn btn-sm btn-outline" onClick={handleCopyQrLink}>
                  {copiedLink ? `✓ ${trT.copied || 'Copied'}` : (trT.copyLink || 'Copy Link')}
                </button>
              </div>

              <div className="modal-actions-footer" style={{ marginTop: '16px', padding: 0 }}>
                <button type="button" className="btn btn-outline" onClick={() => setQrModalData(null)}>
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const tid = qrModalData.traceabilityId
                    setQrModalData(null)
                    onNavigate && onNavigate(`/traceability/${tid}`)
                  }}
                >
                  {trT.viewTimeline || 'Open Public Journey Page'} →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


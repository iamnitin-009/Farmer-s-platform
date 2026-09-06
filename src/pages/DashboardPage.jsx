import { useState, useEffect } from 'react'
import { useLanguage } from '../context/LanguageContext.jsx'
import { getUserListings, getUserOrders, getFarmerOrders, getOrderEscrowStats } from '../utils/auth.js'
import { IconSprout, IconBasket, IconPin } from '../components/Icons.jsx'
import { getGradeBadgeStyle } from '../utils/quality.js'
import { getAllHubAggregations } from '../utils/aggregation.js'
import { getTopDemandedCrops, getDemandBadgeStyle } from '../utils/demandPrediction.js'

export default function DashboardPage({ session, onNavigate, onLogout }) {
  const { t, lang } = useLanguage()
  const dashT = t.dashboard
  const farmerT = t.farmerPortal
  const pkT = t.pickupDecision || {}
  const aggT = t.hubAggregation || {}
  const routeT = t.routeOptimization || {}
  const escrowT = t.paymentEscrow || {}
  const trT = t.traceability || {}
  const dpT = t.demandPrediction || {}

  // Live state of listings and orders for current user initialized on mount
  const [listings] = useState(() => {
    return session?.id ? getUserListings(session.id, session.mobile) : []
  })
  const [orders] = useState(() => {
    return session?.id ? getUserOrders(session.id, session.mobile) : []
  })

  // Global active listings for hub aggregation summary
  const [allListings] = useState(() => {
    try {
      const raw = localStorage.getItem('sih_farmer_listings')
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })
  const hubAggregations = getAllHubAggregations(allListings)
  const activeHubCrops = Object.keys(hubAggregations).filter(
    (c) => hubAggregations[c].totalQuantityKg > 0
  )

  // Calculated totals
  const totalListedValue = listings.reduce((sum, item) => {
    const price = item.price ?? item.expectedPrice ?? 0
    return sum + (item.quantity * price)
  }, 0)

  const totalOrderValue = orders.reduce((sum, order) => {
    return sum + (order.totalAmount || 0)
  }, 0)

  // Escrow statistics for current user (purchases & incoming sales)
  const farmerOrders = session?.id ? getFarmerOrders(session.id, session.mobile) : []
  const combinedUserOrders = [...orders, ...farmerOrders]
  const uniqueUserOrders = Array.from(
    new Map(combinedUserOrders.map((o) => [o.orderId || o.id, o])).values()
  )
  const escrowStats = getOrderEscrowStats(uniqueUserOrders.length > 0 ? uniqueUserOrders : orders)

  // Deterministic top 3 demanded crops forecast
  const topDemandedCrops = getTopDemandedCrops(3, { lang })

  // Active role state
  const [currentRole, setCurrentRole] = useState(session?.role || 'farmer')

  // Automatically redirect admin to /admin
  useEffect(() => {
    if (session?.role === 'admin') {
      onNavigate('/admin')
    }
  }, [session, onNavigate])

  const handleRoleToggle = (targetRole) => {
    setCurrentRole(targetRole)
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('sih_user_session')
        if (raw) {
          const sess = JSON.parse(raw)
          sess.role = targetRole
          localStorage.setItem('sih_user_session', JSON.stringify(sess))
        }
      } catch {}
    }
  }

  return (
    <div className="dashboard-page">
      {/* Top Header / Profile Info */}
      <div className="dashboard-top-bar">
        <div className="section-inner dashboard-nav-inner">
          <div className="user-welcome-info">
            <div className="user-avatar-badge">
              {(session?.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="welcome-name">
                {dashT.welcome}, {session?.name || 'User'}!
              </h1>
              <div className="user-submeta">
                <span className="meta-badge-loc">
                  <IconPin width="13" height="13" />
                  {session?.location || 'India'}
                </span>
                <span className="meta-badge-mobile">📱 {session?.mobile}</span>
                <span className="meta-badge-role">
                  {currentRole === 'buyer' ? '🛒 Buyer Account' : '🧑‍🌾 Farmer Account'}
                </span>
              </div>
            </div>
          </div>

          <div className="dashboard-top-actions">
            <div className="role-mode-switch" role="group" aria-label="Role Switcher">
              <button
                type="button"
                className={`btn-role-mode ${currentRole === 'farmer' ? 'is-active' : ''}`}
                onClick={() => handleRoleToggle('farmer')}
                title="Switch to Farmer View"
              >
                🧑‍🌾 Farmer View
              </button>
              <button
                type="button"
                className={`btn-role-mode ${currentRole === 'buyer' ? 'is-active' : ''}`}
                onClick={() => handleRoleToggle('buyer')}
                title="Switch to Buyer View"
              >
                🛒 Buyer View
              </button>
            </div>

            <button
              type="button"
              className="btn btn-outline btn-logout-dash"
              onClick={onLogout}
            >
              {t.unifiedAuth.logout}
            </button>
          </div>
        </div>
      </div>

      <div className="section-inner dashboard-main">
        {/* ======================================================== */}
        {/* 1. QUICK ACTIONS SECTION (SELL & BUY) */}
        {/* ======================================================== */}
        <section className="quick-actions-section">
          <div className="section-header-row">
            <div>
              <h2 className="section-title">{dashT.quickActionsHeading}</h2>
              <p className="section-subheading">{dashT.quickActionsSubheading}</p>
            </div>
          </div>

          <div className="quick-actions-grid">
            {/* SELL CARD */}
            <div className="quick-action-card sell-card">
              <div className="action-card-header">
                <div className="action-icon-wrap sell-icon">
                  <IconSprout width="32" height="32" />
                </div>
                <span className="role-tag sell-tag">Sell Produce</span>
              </div>
              <h3 className="action-card-title">{dashT.sellTitle}</h3>
              <p className="action-card-desc">{dashT.sellDesc}</p>
              <button
                type="button"
                className="btn btn-primary btn-action-go btn-go-sell"
                onClick={() => onNavigate('/farmer')}
              >
                🧑‍🌾 {dashT.sellBtn}
              </button>
            </div>

            {/* BUY CARD */}
            <div className="quick-action-card buy-card">
              <div className="action-card-header">
                <div className="action-icon-wrap buy-icon">
                  <IconBasket width="32" height="32" />
                </div>
                <span className="role-tag buy-tag">Buy Harvest</span>
              </div>
              <h3 className="action-card-title">{dashT.buyTitle}</h3>
              <p className="action-card-desc">{dashT.buyDesc}</p>
              <button
                type="button"
                className="btn btn-secondary btn-action-go btn-go-buy"
                onClick={() => onNavigate('/buyer')}
              >
                🛒 {dashT.buyBtn}
              </button>
            </div>

            {/* HUB AGGREGATION CARD */}
            <div className="quick-action-card hub-card">
              <div className="action-card-header">
                <div className="action-icon-wrap hub-icon">
                  <span style={{ fontSize: '1.8rem' }}>🚚</span>
                </div>
                <span className="role-tag hub-tag">{aggT.title || 'Hub'}</span>
              </div>
              <h3 className="action-card-title">{aggT.title || 'Hub Aggregation'}</h3>
              <p className="action-card-desc">{aggT.subtitle || 'Consolidated local produce lots at community collection hubs.'}</p>
              <button
                type="button"
                className="btn btn-outline btn-action-go btn-go-hub"
                onClick={() => onNavigate('/hub')}
              >
                🚚 {aggT.btnViewHub || 'View Hub Lots'}
              </button>
            </div>

            {/* ROUTE OPTIMIZATION CARD */}
            <div className="quick-action-card logistics-card">
              <div className="action-card-header">
                <div className="action-icon-wrap logistics-icon">
                  <span style={{ fontSize: '1.8rem' }}>🗺️</span>
                </div>
                <span className="role-tag logistics-tag">{routeT.navTitle || 'Logistics'}</span>
              </div>
              <h3 className="action-card-title">{routeT.title || 'Smart Route Optimization'}</h3>
              <p className="action-card-desc">{routeT.quickActionDesc || 'Plan and sequence multi-stop delivery routes from aggregation hub to buyers.'}</p>
              <button
                type="button"
                className="btn btn-outline btn-action-go btn-go-logistics"
                onClick={() => onNavigate('/logistics')}
              >
                🗺️ {routeT.btnViewLogistics || 'Plan Route'}
              </button>
            </div>

            {/* PRODUCT TRACEABILITY CARD */}
            <div className="quick-action-card traceability-card">
              <div className="action-card-header">
                <div className="action-icon-wrap traceability-icon">
                  <span style={{ fontSize: '1.8rem' }}>🏷️</span>
                </div>
                <span className="role-tag traceability-tag">{trT.navTitle || 'Traceability'}</span>
              </div>
              <h3 className="action-card-title">{trT.title || 'Product Traceability'}</h3>
              <p className="action-card-desc">{trT.subtitle || 'End-to-end transparent produce tracking with public QR journey.'}</p>
              <button
                type="button"
                className="btn btn-outline btn-action-go btn-go-traceability"
                onClick={() => onNavigate('/traceability')}
              >
                🏷️ {trT.navTitle || 'Traceability'} →
              </button>
            </div>
          </div>
        </section>

        {/* ======================================================== */}
        {/* HUB AGGREGATION SUMMARY WIDGET */}
        {/* ======================================================== */}
        {activeHubCrops.length > 0 && (
          <section className="dashboard-hub-summary-section">
            <div className="d-hub-header">
              <div>
                <h3 className="d-hub-title">🚚 {aggT.summaryHeading || 'Active Hub Aggregated Lots'}</h3>
                <p className="d-hub-subtitle">
                  {aggT.hubNotice || 'Consolidated at local collection hub with quantity-weighted pricing.'}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => onNavigate('/hub')}
              >
                {aggT.btnViewHub || 'View Hub Aggregation'} →
              </button>
            </div>

            <div className="d-hub-cards-grid">
              {activeHubCrops.map((ck) => {
                const lot = hubAggregations[ck]
                const cropName = farmerT.crops?.[ck] || ck.charAt(0).toUpperCase() + ck.slice(1)
                return (
                  <div key={ck} className="d-hub-mini-card" onClick={() => onNavigate('/hub')} role="button" tabIndex={0}>
                    <div className="dhm-top">
                      <span className="dhm-name">{cropName} {aggT.aggregatedLot || 'Hub Lot'}</span>
                      <span className="dhm-farmers">{lot.farmerCount} {aggT.farmersContributing || 'farmers'}</span>
                    </div>
                    <div className="dhm-body">
                      <div className="dhm-metric">
                        <span className="dhm-qty">{lot.totalQuantityKg} kg</span>
                        <span className="dhm-sub">{lot.listingCount} {aggT.listingsCombined || 'listings'}</span>
                      </div>
                      <div className="dhm-metric rate">
                        <span className="dhm-price">₹{lot.averagePricePerKg}/kg</span>
                        <span className="dhm-sub">{aggT.averageAskingPrice || 'Avg asking'}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}


        {/* ======================================================== */}
        {/* MARKET DEMAND FORECAST WIDGET */}
        {/* ======================================================== */}
        <section className="dashboard-demand-section">
          <div className="d-demand-header">
            <div>
              <h3 className="d-demand-title">📈 {dpT.forecastTitle || '7-Day Market Demand Forecast'}</h3>
              <p className="d-demand-subtitle">
                {dpT.forecastSubtitle || 'Near-future market demand projected over the next 7 days from transaction velocity and regional benchmarks.'}
              </p>
            </div>
            <span className="d-demand-tagline">
              ✨ {dpT.basisOrders || 'Based on confirmed marketplace orders & regional benchmarks'}
            </span>
          </div>

          <div className="d-demand-cards-grid">
            {topDemandedCrops.map((cropPred) => {
              const badgeStyle = getDemandBadgeStyle(cropPred.demandLevel)
              const cropDisplayName = farmerT.crops?.[cropPred.cropKey] || cropPred.crop
              const predictedVol = cropPred.predictedDemand || cropPred.predictedDemandKg || 0
              return (
                <div key={cropPred.cropKey} className="d-demand-card">
                  <div className="dd-top">
                    <div className="dd-crop-info">
                      <span className="dd-crop-name">{cropDisplayName}</span>
                      <span
                        className="dd-badge-pill"
                        style={{
                          backgroundColor: badgeStyle.bg,
                          color: badgeStyle.color,
                          borderColor: badgeStyle.border,
                        }}
                      >
                        ● {cropPred.demandLevel === 'HIGH'
                            ? (dpT.highDemand || 'High Demand')
                            : cropPred.demandLevel === 'MEDIUM'
                              ? (dpT.mediumDemand || 'Medium Demand')
                              : (dpT.lowDemand || 'Low Demand')}
                      </span>
                    </div>
                    <span className="dd-confidence" title={dpT.confidence || 'Confidence'}>
                      {cropPred.confidence}% {dpT.confidence || 'conf.'}
                    </span>
                  </div>

                  <div className="dd-body">
                    <div className="dd-metric">
                      <span className="dd-qty">
                        {predictedVol > 0 ? `${predictedVol} kg` : (dpT.notEnoughData || 'Pending Data')}
                      </span>
                      <span className="dd-sub">{dpT.predictedDemand || 'Predicted Volume (7 Days)'}</span>
                    </div>

                    <div className="dd-metric trend">
                      <span className={`dd-trend ${cropPred.trendPercent > 0 ? 'trend-up' : cropPred.trendPercent < 0 ? 'trend-down' : ''}`}>
                        {cropPred.trendPercent > 0 ? `+${cropPred.trendPercent}%` : `${cropPred.trendPercent}%`}
                      </span>
                      <span className="dd-sub">{dpT.trend || 'Trend'}</span>
                    </div>
                  </div>

                  <div className="dd-footer">
                    <span className="dd-rec">{cropPred.recommendation}</span>
                    {cropPred.dataSource === 'baseline_estimate' && (
                      <span style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>
                        ℹ️ {dpT.baselineNotice || 'Baseline estimate'}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ======================================================== */}
        {/* 2. ACTIVITY STATS SUMMARY CARDS */}
        {/* ======================================================== */}
        <section className="stats-section">
          <h2 className="section-title">{dashT.summaryHeading}</h2>
          <div className="stats-grid escrow-stats-grid">
            <div className="stat-card">
              <span className="stat-label">{dashT.statListings}</span>
              <span className="stat-num">{listings.length}</span>
              <span className="stat-sub">
                ₹{totalListedValue.toLocaleString('en-IN')} {dashT.statSalesEst}
              </span>
            </div>

            <div className="stat-card stat-escrow-active">
              <span className="stat-label">{escrowT.statActiveOrders || 'Active Orders'}</span>
              <span className="stat-num">{escrowStats.activeOrders}</span>
              <span className="stat-sub">
                {orders.length} {dashT.statOrders} (₹{totalOrderValue.toLocaleString('en-IN')})
              </span>
            </div>

            <div className="stat-card stat-escrow-secured">
              <span className="stat-label">{escrowT.statSecuredEscrow || 'Secured in Escrow'}</span>
              <span className="stat-num">₹{escrowStats.securedPayments.toLocaleString('en-IN')}</span>
              <span className="stat-sub">
                🔒 {escrowT.simulatedEscrow || 'Simulated Escrow'}
              </span>
            </div>

            <div className="stat-card stat-escrow-transit">
              <span className="stat-label">{escrowT.statInTransit || 'In Transit'}</span>
              <span className="stat-num">{escrowStats.ordersInTransit}</span>
              <span className="stat-sub">
                🚚 {escrowT.inTransit || 'En Route'}
              </span>
            </div>

            <div className="stat-card stat-escrow-completed">
              <span className="stat-label">{escrowT.statCompleted || 'Completed Orders'}</span>
              <span className="stat-num">{escrowStats.completedOrders}</span>
              <span className="stat-sub">
                ✅ {escrowT.paymentReleased || 'Released'}
              </span>
            </div>
          </div>
        </section>

        {/* ======================================================== */}
        {/* 3. COMBINED ACTIVITY PANELS (MY LISTINGS & MY ORDERS) */}
        {/* ======================================================== */}
        <div className="combined-activity-grid">
          {/* MY LISTINGS PANEL */}
          <div className="activity-panel listings-panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">{dashT.myListingsTitle}</h3>
                <p className="panel-subtitle">{dashT.myListingsSubtitle}</p>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => onNavigate('/farmer')}
              >
                {dashT.btnCreateListing}
              </button>
            </div>

            {listings.length === 0 ? (
              <div className="panel-empty-state">
                <div className="empty-mini-icon">🌱</div>
                <h4>{dashT.noListingsYet}</h4>
                <p>{dashT.noListingsAction}</p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => onNavigate('/farmer')}
                  style={{ marginTop: '10px' }}
                >
                  {dashT.btnCreateListing}
                </button>
              </div>
            ) : (
              <div className="mini-cards-list">
                {listings.slice(0, 5).map((item) => {
                  const cropName = farmerT.crops[item.crop] || item.crop
                  const unitPrice = item.price ?? item.expectedPrice ?? 0
                  const lotVal = (item.quantity * unitPrice).toLocaleString('en-IN')

                  return (
                    <div className="mini-item-card listing-item" key={item.id}>
                      <div className="mini-item-main">
                        <div className="mini-icon">
                          <IconSprout width="20" height="20" />
                        </div>
                        <div>
                          <h4 className="mini-crop-title">{cropName}</h4>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span className="mini-meta-loc">
                              <IconPin width="12" height="12" /> {item.location}
                            </span>
                            {item.quality?.grade && (
                              <span
                                className="produce-quality-tag"
                                style={{
                                  backgroundColor: getGradeBadgeStyle(item.quality.grade).bg,
                                  color: getGradeBadgeStyle(item.quality.grade).color,
                                  border: `1px solid ${getGradeBadgeStyle(item.quality.grade).border}`,
                                  fontSize: '0.7rem',
                                  padding: '1px 6px',
                                  margin: 0,
                                }}
                              >
                                ● {item.quality.grade} ({item.quality.score})
                              </span>
                            )}
                            {item.pickupDecision?.method && (
                              <span className={`pickup-badge mini ${item.pickupDecision.method === 'HUB' ? 'hub' : 'home'}`}>
                                {item.pickupDecision.method === 'HUB' ? `🚚 ${pkT.hubBadge || 'Hub Pickup'}` : `🚜 ${pkT.homeBadge || 'Farm Pickup'}`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mini-metrics">
                        <button
                          type="button"
                          className="btn-mini-trace"
                          onClick={() => onNavigate('/traceability/' + (item.traceabilityId || item.id))}
                          title={trT.viewTimeline || 'View Traceability'}
                        >
                          🏷️ {trT.navTitle || 'Trace'}
                        </button>
                        <div className="mini-metric">
                          <span className="m-label">{dashT.quantity}</span>
                          <span className="m-val">{item.quantity} kg</span>
                        </div>
                        <div className="mini-metric">
                          <span className="m-label">{dashT.rate}</span>
                          <span className="m-val">₹{unitPrice}/kg</span>
                        </div>
                        <div className="mini-metric highlight">
                          <span className="m-label">{dashT.total}</span>
                          <span className="m-val">₹{lotVal}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* MY ORDERS PANEL */}
          <div className="activity-panel orders-panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">{dashT.myOrdersTitle}</h3>
                <p className="panel-subtitle">{dashT.myOrdersSubtitle}</p>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => onNavigate('/buyer')}
              >
                {dashT.btnBrowseMarket}
              </button>
            </div>

            {orders.length === 0 ? (
              <div className="panel-empty-state">
                <div className="empty-mini-icon">🛒</div>
                <h4>{dashT.noOrdersYet}</h4>
                <p>{dashT.noOrdersAction}</p>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onNavigate('/buyer')}
                  style={{ marginTop: '10px' }}
                >
                  {dashT.btnBrowseMarket}
                </button>
              </div>
            ) : (
              <div className="mini-cards-list">
                {orders.slice(0, 5).map((order) => {
                  const cropName = farmerT.crops[order.crop] || order.crop
                  const orderDate = new Date(order.createdAt).toLocaleDateString()

                  return (
                    <div className="mini-item-card order-item" key={order.id}>
                      <div className="mini-item-main">
                        <div className="mini-icon">
                          <IconBasket width="20" height="20" />
                        </div>
                        <div>
                          <div className="order-id-tag">#{order.orderId || order.id}</div>
                          <h4 className="mini-crop-title">{cropName}</h4>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                            <span className="mini-meta-date">{orderDate}</span>
                            <span className={`mini-escrow-pill ${order.fulfillmentStatus === 'PAYMENT_RELEASED' ? 'released' : 'secured'}`}>
                              {order.fulfillmentStatus === 'PAYMENT_RELEASED'
                                ? '✅ ' + (escrowT.paymentReleased || 'Released')
                                : order.fulfillmentStatus === 'DELIVERED'
                                ? '📦 ' + (escrowT.delivered || 'Delivered')
                                : order.fulfillmentStatus === 'IN_TRANSIT'
                                ? '🚚 ' + (escrowT.inTransit || 'In Transit')
                                : '🔒 ' + (escrowT.paymentSecured || 'Payment Secured')}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mini-metrics">
                        <button
                          type="button"
                          className="btn-mini-trace"
                          onClick={() => onNavigate('/traceability/' + (order.traceabilityId || order.orderId || order.id))}
                          title={trT.trackProduce || 'Track Journey'}
                        >
                          🏷️ {trT.navTitle || 'Trace'}
                        </button>
                        <div className="mini-metric">
                          <span className="m-label">{dashT.quantity}</span>
                          <span className="m-val">{order.quantity} kg</span>
                        </div>
                        <div className="mini-metric">
                          <span className="m-label">{dashT.rate}</span>
                          <span className="m-val">₹{order.pricePerKg}/kg</span>
                        </div>
                        <div className="mini-metric highlight">
                          <span className="m-label">{dashT.total}</span>
                          <span className="m-val">₹{(order.totalAmount || 0).toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

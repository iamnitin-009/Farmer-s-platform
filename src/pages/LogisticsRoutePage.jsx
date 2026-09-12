import { useState, useMemo } from 'react'
import { useLanguage } from '../context/LanguageContext.jsx'
import { getAllHubAggregations } from '../utils/aggregation.js'
import { getAllOrders } from '../utils/auth.js'
import {
  optimizeDeliveryRoute,
  getDemoBuyerDestinations,
  saveOptimizedRoute,
} from '../utils/routeOptimization.js'
import { IconPin } from '../components/Icons.jsx'
import { CROP_KEYS, CROP_ICONS } from '../utils/cropConstants.js'

export default function LogisticsRoutePage({ _session, onNavigate }) {
  const { t, lang } = useLanguage()
  const routeT = t.routeOptimization || {}
  const aggT = t.hubAggregation || {}
  const farmerT = t.farmerPortal || {}

  // 1. Read existing listings for hub aggregation
  const [listings] = useState(() => {
    try {
      const raw = localStorage.getItem('sih_farmer_listings')
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })

  const hubAggregations = useMemo(() => getAllHubAggregations(listings), [listings])
  const activeHubCrops = useMemo(() => {
    return Object.keys(hubAggregations).filter(
      (c) => hubAggregations[c].totalQuantityKg > 0
    )
  }, [hubAggregations])

  // Selected crop (defaults to first active crop, or whitelisted CROP-001 crop)
  const defaultCrop = activeHubCrops.length > 0 ? activeHubCrops[0] : (CROP_KEYS[0] || 'rice')
  const [selectedCrop, setSelectedCrop] = useState(defaultCrop)

  // Current hub lot
  const currentHubLot = hubAggregations[selectedCrop] || {
    crop: selectedCrop,
    totalQuantityKg: 90,
    farmerCount: 3,
    averagePricePerKg: 31.2,
    fairPricePerKg: 30.5,
  }

  // Hub location origin
  const [hubLocation, setHubLocation] = useState('Azadpur Mandi Hub, Delhi')

  // 2. Read existing buyer orders
  const [buyerOrders] = useState(() => getAllOrders())

  // Base buyer destinations for the selected crop
  const defaultDestinations = useMemo(() => {
    // 1. Match real orders from localStorage
    const matchingOrders = buyerOrders.filter(
      (o) => o.crop && o.crop.toLowerCase().trim() === selectedCrop.toLowerCase().trim()
    )

    if (matchingOrders.length >= 2) {
      return matchingOrders.map((o, idx) => ({
        id: o.id || ('ORD_' + idx),
        buyerName: o.buyerName || ('Buyer ' + (idx + 1)),
        location: o.buyerLocation || 'Delhi',
        quantityKg: o.quantity || 20,
        isRealOrder: true,
      }))
    }

    // 2. Fall back to demo buyer destinations
    const lotQty = currentHubLot.totalQuantityKg > 0 ? currentHubLot.totalQuantityKg : 90
    return getDemoBuyerDestinations(selectedCrop, lotQty)
  }, [buyerOrders, selectedCrop, currentHubLot.totalQuantityKg])

  // Custom buyer destination list state
  const [buyersList, setBuyersList] = useState(defaultDestinations)

  // Sync buyers when crop changes
  const handleCropChange = (newCrop) => {
    setSelectedCrop(newCrop)
    const lotQty = hubAggregations[newCrop]?.totalQuantityKg || 90
    setBuyersList(getDemoBuyerDestinations(newCrop, lotQty))
  }

  // Form state for adding custom buyer
  const [newBuyerName, setNewBuyerName] = useState('')
  const [newBuyerLocation, setNewBuyerLocation] = useState('')
  const [newBuyerQty, setNewBuyerQty] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [toastMessage, setToastMessage] = useState(null)

  // Add custom buyer destination
  const handleAddBuyer = (e) => {
    e.preventDefault()
    if (!newBuyerName.trim() || !newBuyerLocation.trim() || !newBuyerQty) return

    const newEntry = {
      id: 'CUSTOM_' + Date.now(),
      buyerName: newBuyerName.trim(),
      location: newBuyerLocation.trim(),
      quantityKg: parseFloat(newBuyerQty) || 10,
    }

    setBuyersList((prev) => [...prev, newEntry])
    setNewBuyerName('')
    setNewBuyerLocation('')
    setNewBuyerQty('')
    setShowAddForm(false)
  }

  // Remove a buyer
  const handleRemoveBuyer = (id) => {
    setBuyersList((prev) => prev.filter((b) => b.id !== id))
  }

  // Reset to default demo buyers
  const handleResetBuyers = () => {
    const lotQty = currentHubLot.totalQuantityKg > 0 ? currentHubLot.totalQuantityKg : 90
    setBuyersList(getDemoBuyerDestinations(selectedCrop, lotQty))
  }

  // 3. Compute optimized route
  const optimizedResult = useMemo(() => {
    return optimizeDeliveryRoute({
      hubLocation,
      crop: selectedCrop,
      buyers: buyersList,
      lang,
    })
  }, [hubLocation, selectedCrop, buyersList, lang])

  // 4. Save route to localStorage
  const handleSaveRoute = () => {
    const ok = saveOptimizedRoute(optimizedResult)
    if (ok) {
      setToastMessage(routeT.routeSavedToast || 'Delivery route saved to local storage!')
      setTimeout(() => setToastMessage(null), 3500)
    }
  }

  const cropName = farmerT.crops?.[selectedCrop] || selectedCrop.charAt(0).toUpperCase() + selectedCrop.slice(1)
  const cropIcon = CROP_ICONS[selectedCrop] || '🌱'

  return (
    <div className="logistics-page">
      {/* Top Banner Header */}
      <div className="logistics-top-bar">
        <div className="section-inner logistics-top-inner">
          <div className="logistics-title-row">
            <span className="logistics-hero-icon">🚚</span>
            <div>
              <h1 className="logistics-main-title">{routeT.title || 'Smart Route Optimization'}</h1>
              <p className="logistics-subtitle">
                {routeT.subtitle || 'Nearest-neighbor delivery sequence from hub aggregation to buyer endpoints.'}
              </p>
            </div>
          </div>

          <div className="logistics-nav-actions">
            <button
              type="button"
              className="btn btn-outline btn-hub-dash"
              onClick={() => onNavigate('/dashboard')}
            >
              {t.dashboard?.backToDashboard || 'Dashboard'}
            </button>
            <button
              type="button"
              className="btn btn-outline btn-hub-market"
              onClick={() => onNavigate('/hub')}
            >
              🚚 {aggT.title || 'Hub Aggregation'}
            </button>
          </div>
        </div>
      </div>

      <div className="section-inner logistics-main-content">
        {/* Toast Alert */}
        {toastMessage && (
          <div className="alert-success" role="alert" style={{ marginBottom: '20px' }}>
            <div className="alert-success-icon">✓</div>
            <div className="alert-success-content">
              <strong>{toastMessage}</strong>
            </div>
          </div>
        )}

        {/* Demo explanation notice */}
        <div className="logistics-notice-card">
          <span className="logistics-notice-icon">🧠</span>
          <div>
            <strong>{routeT.methodBadge || 'Nearest-Neighbor Optimized Route'}:</strong>{' '}
            <span>{routeT.demoNotice || 'Deterministic route planner sequences deliveries from aggregation hub to minimize total road transit distance.'}</span>
          </div>
        </div>

        {/* Top Control Bar: Crop & Hub Selector */}
        <div className="logistics-control-card">
          <div className="control-group">
            <label className="control-label">{routeT.selectLot || 'Select Aggregated Hub Lot'}:</label>
            <div className="logistics-crop-pills">
              {CROP_KEYS.map((ck) => {
                const isSelected = selectedCrop === ck
                const hasLot = hubAggregations[ck]?.totalQuantityKg > 0
                return (
                  <button
                    key={ck}
                    type="button"
                    className={`logistics-crop-pill ${isSelected ? 'active' : ''}`}
                    onClick={() => handleCropChange(ck)}
                  >
                    <span>{CROP_ICONS[ck] || '🌱'}</span>
                    <span>{farmerT.crops?.[ck] || ck}</span>
                    {hasLot && <span className="pill-qty-badge">{hubAggregations[ck].totalQuantityKg} kg</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="control-group hub-input-group">
            <label className="control-label">{routeT.hubOrigin || 'Aggregation Hub Origin'}:</label>
            <div className="hub-input-wrap">
              <IconPin width="16" height="16" />
              <input
                type="text"
                className="hub-input-field"
                value={hubLocation}
                onChange={(e) => setHubLocation(e.target.value)}
                placeholder="Enter Hub City/Location"
              />
            </div>
          </div>
        </div>

        {/* 4 Summary Cards */}
        <div className="logistics-stats-grid">
          <div className="logistics-stat-card highlight">
            <span className="l-stat-label">{routeT.totalDistance || 'Total Optimized Distance'}</span>
            <span className="l-stat-val primary">{optimizedResult.totalDistanceKm} {routeT.km || 'km'}</span>
            <span className="l-stat-sub">Shortest-leg sequence</span>
          </div>

          <div className="logistics-stat-card">
            <span className="l-stat-label">{routeT.totalStops || 'Delivery Stops'}</span>
            <span className="l-stat-val">{optimizedResult.totalStops}</span>
            <span className="l-stat-sub">Buyer endpoints</span>
          </div>

          <div className="logistics-stat-card">
            <span className="l-stat-label">{routeT.estimatedTime || 'Estimated Transit Time'}</span>
            <span className="l-stat-val">{optimizedResult.estimatedTimeMinutes} {routeT.mins || 'min'}</span>
            <span className="l-stat-sub">@ 35 km/h + 10m stop</span>
          </div>

          <div className="logistics-stat-card volume">
            <span className="l-stat-label">{routeT.dispatchedVolume || 'Total Volume Dispatched'}</span>
            <span className="l-stat-val">{currentHubLot.totalQuantityKg} kg</span>
            <span className="l-stat-sub">{cropIcon} {cropName}</span>
          </div>
        </div>

        {/* Main 2-Column Section: Left Timeline, Right Buyer Stops Management */}
        <div className="logistics-grid-layout">
          {/* LEFT COLUMN: Visual Route Timeline */}
          <div className="logistics-timeline-card">
            <div className="timeline-header">
              <div>
                <h3 className="timeline-title">
                  <span>🗺️</span> {routeT.timelineHeading || 'Optimized Delivery Timeline'}
                </h3>
                <span className="timeline-badge">{routeT.methodBadge || 'Nearest-Neighbor Optimized Route'}</span>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm btn-save-route"
                onClick={handleSaveRoute}
                disabled={optimizedResult.totalStops === 0}
              >
                💾 {routeT.btnSaveRoute || 'Confirm & Save Route'}
              </button>
            </div>

            {optimizedResult.totalStops === 0 ? (
              <div className="empty-route-state">
                <p>{routeT.noLotsTitle || 'No buyer destinations available for routing.'}</p>
                <button type="button" className="btn btn-outline btn-sm" onClick={handleResetBuyers}>
                  Load Demo Buyers
                </button>
              </div>
            ) : (
              <div className="route-timeline-flow">
                {/* START NODE: Aggregation Hub */}
                <div className="timeline-node hub-node">
                  <div className="node-icon-circle hub-circle">
                    <span>🏢</span>
                  </div>
                  <div className="node-content hub-content">
                    <div className="node-badge hub-tag">{routeT.hubDeparture || 'Hub Dispatch Point'}</div>
                    <h4 className="node-title">{hubLocation}</h4>
                    <div className="node-meta">
                      <span>📦 {cropName}: <strong>{currentHubLot.totalQuantityKg} kg</strong> combined</span>
                      <span>🧑‍🌾 {currentHubLot.farmerCount} farmers contributing</span>
                    </div>
                  </div>
                </div>

                {/* STOPS FLOW */}
                {optimizedResult.route.map((stop) => (
                  <div key={stop.stopNumber} className="timeline-step-wrap">
                    {/* Connecting transit road line */}
                    <div className="timeline-connector">
                      <div className="connector-line"></div>
                      <div className="connector-badge">
                        <span>↓ {stop.distanceFromPreviousKm} {routeT.km || 'km'}</span>
                        <span className="c-dot">•</span>
                        <span>~{Math.max(5, Math.round((stop.distanceFromPreviousKm / 35) * 60))} {routeT.mins || 'min'} transit</span>
                      </div>
                    </div>

                    {/* STOP CARD */}
                    <div className="timeline-node stop-node">
                      <div className="node-icon-circle stop-circle">
                        <span>{stop.stopNumber}</span>
                      </div>
                      <div className="node-content stop-content">
                        <div className="stop-header-row">
                          <span className="stop-pill">{routeT.stopNumber || 'Stop'} #{stop.stopNumber}</span>
                          <span className="stop-eta">
                            ⏱️ {routeT.eta || 'ETA'}: <strong>+{stop.estimatedArrivalMinutes} {routeT.mins || 'min'}</strong>
                          </span>
                        </div>

                        <h4 className="node-title">{stop.buyerName}</h4>

                        <div className="stop-details-grid">
                          <div className="stop-detail-item">
                            <span className="sd-label">{routeT.destination || 'Delivery Location'}:</span>
                            <span className="sd-val">
                              <IconPin width="12" height="12" /> {stop.location}
                            </span>
                          </div>

                          <div className="stop-detail-item">
                            <span className="sd-label">{routeT.dropQuantity || 'Delivery Volume'}:</span>
                            <span className="sd-val highlight">{stop.quantityKg} kg</span>
                          </div>

                          <div className="stop-detail-item">
                            <span className="sd-label">{routeT.legDistance || 'Leg Distance'}:</span>
                            <span className="sd-val">{stop.distanceFromPreviousKm} {routeT.km || 'km'}</span>
                          </div>

                          <div className="stop-detail-item">
                            <span className="sd-label">{routeT.cumulativeDistance || 'Cumulative'}:</span>
                            <span className="sd-val">{stop.cumulativeDistanceKm} {routeT.km || 'km'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Destination Stops Manager */}
          <div className="logistics-buyers-card">
            <div className="buyers-card-header">
              <div>
                <h3 className="buyers-title">
                  <span>📍</span> {routeT.totalStops || 'Delivery Stops'} ({buyersList.length})
                </h3>
                <p className="buyers-subtitle">
                  Configure buyer delivery endpoints to observe automatic nearest-neighbor re-routing.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={handleResetBuyers}
                  title="Reset to default demo buyers"
                >
                  🔄 Reset
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowAddForm(!showAddForm)}
                >
                  {showAddForm ? '✕ Close' : '+ Add Stop'}
                </button>
              </div>
            </div>

            {/* Add Buyer Form */}
            {showAddForm && (
              <form className="add-buyer-form" onSubmit={handleAddBuyer}>
                <h4 className="form-subheading">{routeT.btnAddStop || 'Add Custom Buyer Stop'}</h4>
                <div className="form-row">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Buyer / Business Name"
                    value={newBuyerName}
                    onChange={(e) => setNewBuyerName(e.target.value)}
                    required
                  />
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Location / City (e.g. Meerut, Noida)"
                    value={newBuyerLocation}
                    onChange={(e) => setNewBuyerLocation(e.target.value)}
                    required
                  />
                  <input
                    type="number"
                    className="form-input"
                    placeholder="Quantity (kg)"
                    value={newBuyerQty}
                    onChange={(e) => setNewBuyerQty(e.target.value)}
                    min="1"
                    required
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                  <button type="submit" className="btn btn-primary btn-sm">
                    Add Delivery Stop
                  </button>
                </div>
              </form>
            )}

            {/* Active Buyers List */}
            <div className="buyers-list">
              {buyersList.map((buyer, idx) => (
                <div key={buyer.id || idx} className="buyer-dest-item">
                  <div className="b-dest-left">
                    <span className="b-dest-index">{idx + 1}</span>
                    <div>
                      <div className="b-dest-name">{buyer.buyerName || buyer.name}</div>
                      <div className="b-dest-loc">
                        <IconPin width="12" height="12" /> {buyer.location}
                      </div>
                    </div>
                  </div>
                  <div className="b-dest-right">
                    <span className="b-dest-qty">{buyer.quantityKg} kg</span>
                    <button
                      type="button"
                      className="btn-remove-stop"
                      onClick={() => handleRemoveBuyer(buyer.id)}
                      title="Remove this stop"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

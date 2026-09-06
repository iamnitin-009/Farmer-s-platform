import React, { useState, useEffect } from 'react'
import { useLanguage } from '../context/LanguageContext.jsx'
import {
  buildTraceabilityData,
  generateQrDataUrl,
  getTraceabilityUrl,
} from '../utils/traceability.js'
import { getGradeBadgeStyle } from '../utils/quality.js'
import { IconSprout, IconPin, IconTag, IconLeaf } from '../components/Icons.jsx'

export default function TraceabilityPage({ traceabilityId, onNavigate, session }) {
  const { t, lang } = useLanguage()
  const trT = t.traceability || {}
  const portalT = t.farmerPortal || {}
  const qT = t.qualityCheck || {}
  const fpT = t.fairPrice || {}
  const pkT = t.pickupDecision || {}
  const aggT = t.hubAggregation || {}
  const escrowT = t.paymentEscrow || {}

  const [activeId, setActiveId] = useState(traceabilityId || '')
  const [searchInput, setSearchInput] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const [copied, setCopied] = useState(false)

  // Derive public journey data safely
  const journey = activeId ? buildTraceabilityData(activeId) : null

  // Generate QR code whenever activeId changes
  useEffect(() => {
    if (journey?.traceabilityId) {
      const fullUrl = getTraceabilityUrl(journey.traceabilityId)
      generateQrDataUrl(fullUrl).then((url) => setQrUrl(url))
    } else {
      setQrUrl('')
    }
  }, [journey?.traceabilityId])

  // If prop traceabilityId changes
  useEffect(() => {
    if (traceabilityId && traceabilityId !== activeId) {
      setActiveId(traceabilityId)
    }
  }, [traceabilityId])

  const handleSearch = (e) => {
    e.preventDefault()
    if (searchInput.trim()) {
      setActiveId(searchInput.trim())
      if (onNavigate) {
        onNavigate(`/traceability/${searchInput.trim()}`)
      }
    }
  }

  const handleCopyLink = () => {
    if (!journey?.traceabilityId) return
    const fullUrl = getTraceabilityUrl(journey.traceabilityId)
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Sample demo IDs for quick testing if empty
  const sampleListings = (() => {
    try {
      const raw = localStorage.getItem('sih_farmer_listings')
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })()

  return (
    <div className="traceability-page">
      {/* Top Navigation Bar */}
      <div className="farmer-portal-top">
        <div className="section-inner farmer-nav-inner">
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {session && (
              <button
                className="btn-back-home btn-back-dash"
                type="button"
                onClick={() => onNavigate('/dashboard')}
                style={{ fontWeight: '600' }}
              >
                ← {t.dashboard?.backToDashboard || 'Dashboard'}
              </button>
            )}
            <button
              className="btn-back-home"
              type="button"
              onClick={() => onNavigate('/buyer')}
            >
              {trT.backToMarketplace || 'Marketplace'}
            </button>
            <button
              className="btn-back-home"
              type="button"
              onClick={() => onNavigate('/')}
            >
              {portalT.backToHome || 'Home'}
            </button>
          </div>
        </div>
      </div>

      <div className="section-inner traceability-main">
        {/* Page Header */}
        <header className="traceability-header">
          <div className="tr-header-icon">🌾</div>
          <div>
            <h1 className="traceability-title">{trT.title || 'Product Traceability'}</h1>
            <p className="section-subheading">
              {trT.subtitle || 'End-to-end transparent journey from farm harvest to consumer delivery'}
            </p>
          </div>
        </header>

        {/* Search Bar for Traceability ID */}
        <form onSubmit={handleSearch} className="traceability-search-bar">
          <input
            type="text"
            className="tr-search-input"
            placeholder="Enter Traceability ID (e.g. TRC-2026-XXXXXX or Listing ID)..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="btn btn-primary tr-search-btn">
            🔍 {trT.trackJourney || 'Track Journey'}
          </button>
        </form>

        {/* NOT FOUND STATE */}
        {!journey ? (
          <div className="empty-state-card tr-not-found-card">
            <div className="empty-state-icon">🔍</div>
            <h3>{trT.notFoundTitle || 'Produce Journey Not Found'}</h3>
            <p>
              {trT.notFoundSubtitle ||
                'The requested traceability ID does not match any registered harvest lot or order.'}
            </p>

            {sampleListings.length > 0 && (
              <div className="sample-tr-chips" style={{ marginTop: '16px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  Try an active produce lot from storage:
                </span>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '8px' }}>
                  {sampleListings.slice(0, 4).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="tr-chip-btn"
                      onClick={() => {
                        const tid = item.traceabilityId || item.id
                        setActiveId(tid)
                        if (onNavigate) onNavigate(`/traceability/${tid}`)
                      }}
                    >
                      🌱 {item.crop} ({item.traceabilityId || item.id})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* TRACEABILITY CONTENT */
          <div className="traceability-content-layout">
            {/* Left Column: QR Card & Summary */}
            <div className="tr-overview-column">
              <div className="tr-qr-card">
                <div className="tr-qr-badge">
                  <span>📱 {trT.scanQr || 'Scan QR Code'}</span>
                </div>

                {qrUrl ? (
                  <div className="tr-qr-image-wrap">
                    <img src={qrUrl} alt="Product Traceability QR Code" className="tr-qr-img" />
                  </div>
                ) : (
                  <div className="tr-qr-placeholder">Generating QR...</div>
                )}

                <div className="tr-id-callout">
                  <span className="tr-id-label">{trT.traceabilityId || 'Traceability ID'}:</span>
                  <strong className="tr-id-code">{journey.traceabilityId}</strong>
                </div>

                <p className="tr-qr-hint">
                  {trT.qrModalSubtitle || 'Scan with any smartphone camera to inspect the verified journey.'}
                </p>

                <div className="tr-qr-actions">
                  <button type="button" className="btn btn-outline btn-sm" onClick={handleCopyLink}>
                    {copied ? (trT.linkCopied || 'Link Copied!') : (trT.copyLink || '📋 Copy Link')}
                  </button>
                </div>
              </div>

              {/* Crop Quick Meta Card */}
              <div className="tr-meta-card">
                <h3 className="tr-meta-card-title">{journey.crop} Harvest Lot</h3>
                <div className="tr-meta-grid">
                  <div className="tr-meta-item">
                    <span className="tr-meta-lbl">{trT.quantity || 'Lot Quantity'}:</span>
                    <strong className="tr-meta-val">{journey.quantityKg} kg</strong>
                  </div>
                  <div className="tr-meta-item">
                    <span className="tr-meta-lbl">{portalT.priceLabel || 'Rate'}:</span>
                    <strong className="tr-meta-val">₹{journey.unitPrice}/kg</strong>
                  </div>
                  <div className="tr-meta-item">
                    <span className="tr-meta-lbl">Estimated Value:</span>
                    <strong className="tr-meta-val highlight">
                      ₹{(journey.quantityKg * journey.unitPrice).toLocaleString('en-IN')}
                    </strong>
                  </div>
                </div>
                <div className="tr-mvp-badge">
                  <span>🛡️ {trT.demoNotice || 'QR-Based MVP Traceability — Transparency Powered by Open Data'}</span>
                </div>
              </div>
            </div>

            {/* Right Column: The 9-Stage Chronological Produce Journey */}
            <div className="tr-timeline-column">
              <div className="tr-journey-header">
                <h2>{trT.produceJourney || 'Produce Journey'}</h2>
                <span className="tr-stage-count">
                  {Object.values(journey.stages).filter((s) => s.isComplete).length} / 9 Stages Verified
                </span>
              </div>

              <div className="tr-stages-timeline">
                {/* STAGE 1: PRODUCE LISTED */}
                <div className="tr-stage-item completed">
                  <div className="tr-stage-indicator">
                    <span className="tr-dot">✓</span>
                    <div className="tr-line" />
                  </div>
                  <div className="tr-stage-card">
                    <div className="tr-stage-top">
                      <div className="tr-stage-title-wrap">
                        <span className="tr-stage-num">Stage 1</span>
                        <h4 className="tr-stage-name">🌾 {trT.produceListed || 'Produce Listed'}</h4>
                      </div>
                      <span className="tr-badge-verified">✓ {trT.verifiedStage || 'Verified'}</span>
                    </div>
                    <p className="tr-stage-desc">
                      {trT.farmerListed || 'Farmer listed the harvest produce on the transparent marketplace.'}
                    </p>
                    <div className="tr-data-grid">
                      <div><strong>{trT.farmer || 'Farmer'}:</strong> {journey.stages.farmerListing.farmerName}</div>
                      <div><strong>{trT.location || 'Location'}:</strong> {journey.stages.farmerListing.location}</div>
                      <div><strong>{trT.harvestDate || 'Harvest Date'}:</strong> {journey.stages.farmerListing.harvestDate}</div>
                      <div><strong>Initial Lot:</strong> {journey.stages.farmerListing.quantityKg} kg @ ₹{journey.stages.farmerListing.ratePerKg}/kg</div>
                    </div>
                  </div>
                </div>

                {/* STAGE 2: AI QUALITY INSPECTION */}
                <div className={`tr-stage-item ${journey.stages.quality.isComplete ? 'completed' : 'pending'}`}>
                  <div className="tr-stage-indicator">
                    <span className="tr-dot">{journey.stages.quality.isComplete ? '✓' : '○'}</span>
                    <div className="tr-line" />
                  </div>
                  <div className="tr-stage-card">
                    <div className="tr-stage-top">
                      <div className="tr-stage-title-wrap">
                        <span className="tr-stage-num">Stage 2</span>
                        <h4 className="tr-stage-name">✨ {trT.aiQualityChecked || 'AI Quality Checked'}</h4>
                      </div>
                      <span className={journey.stages.quality.isComplete ? 'tr-badge-verified' : 'tr-badge-pending'}>
                        {journey.stages.quality.isComplete ? (trT.verifiedStage || 'Verified') : (trT.notAvailableYet || 'Not available yet')}
                      </span>
                    </div>
                    {journey.stages.quality.isComplete ? (
                      <>
                        <div className="tr-grade-banner">
                          <span
                            className="tr-grade-pill"
                            style={{
                              backgroundColor: getGradeBadgeStyle(journey.stages.quality.grade).bg,
                              color: getGradeBadgeStyle(journey.stages.quality.grade).color,
                              border: `1.5px solid ${getGradeBadgeStyle(journey.stages.quality.grade).border}`,
                            }}
                          >
                            Grade {journey.stages.quality.grade} ({journey.stages.quality.score}/100)
                          </span>
                          <span className="tr-confidence">
                            {trT.confidence || 'Confidence'}: {Math.round(journey.stages.quality.confidence * 100)}%
                          </span>
                        </div>
                        {journey.stages.quality.observations && (
                          <ul className="tr-obs-list">
                            {journey.stages.quality.observations.map((obs, idx) => (
                              <li key={idx}>✓ {obs}</li>
                            ))}
                          </ul>
                        )}
                        <span className="tr-sub-attribution">
                          🤖 {trT.verifiedByAi || 'Verified by Groq AI'}
                        </span>
                      </>
                    ) : (
                      <p className="tr-pending-text">{trT.notAvailableYet || 'Not available yet — Produce unassessed'}</p>
                    )}
                  </div>
                </div>

                {/* STAGE 3: FAIR PRICE BENCHMARK */}
                <div className={`tr-stage-item ${journey.stages.fairPrice.isComplete ? 'completed' : 'pending'}`}>
                  <div className="tr-stage-indicator">
                    <span className="tr-dot">{journey.stages.fairPrice.isComplete ? '✓' : '○'}</span>
                    <div className="tr-line" />
                  </div>
                  <div className="tr-stage-card">
                    <div className="tr-stage-top">
                      <div className="tr-stage-title-wrap">
                        <span className="tr-stage-num">Stage 3</span>
                        <h4 className="tr-stage-name">⚖️ {trT.fairPriceBenchmark || 'Fair Price Benchmark'}</h4>
                      </div>
                      <span className={journey.stages.fairPrice.isComplete ? 'tr-badge-verified' : 'tr-badge-pending'}>
                        {journey.stages.fairPrice.isComplete ? (trT.verifiedStage || 'Verified') : (trT.notAvailableYet || 'Not available yet')}
                      </span>
                    </div>
                    {journey.stages.fairPrice.isComplete ? (
                      <div className="tr-data-grid">
                        <div>
                          <strong>{trT.suggestedPrice || 'Fair Price'}:</strong>{' '}
                          <span className="tr-highlight-rate">₹{journey.stages.fairPrice.suggestedPrice}/kg</span>
                        </div>
                        <div>
                          <strong>{trT.marketRange || 'Market Range'}:</strong> ₹{journey.stages.fairPrice.minPrice} – ₹{journey.stages.fairPrice.maxPrice}/kg
                        </div>
                      </div>
                    ) : (
                      <p className="tr-pending-text">{trT.notAvailableYet || 'Not available yet'}</p>
                    )}
                  </div>
                </div>

                {/* STAGE 4: PICKUP DECIDED */}
                <div className={`tr-stage-item ${journey.stages.pickup.isComplete ? 'completed' : 'pending'}`}>
                  <div className="tr-stage-indicator">
                    <span className="tr-dot">{journey.stages.pickup.isComplete ? '✓' : '○'}</span>
                    <div className="tr-line" />
                  </div>
                  <div className="tr-stage-card">
                    <div className="tr-stage-top">
                      <div className="tr-stage-title-wrap">
                        <span className="tr-stage-num">Stage 4</span>
                        <h4 className="tr-stage-name">🚚 {trT.pickupDecision || 'Pickup Decided'}</h4>
                      </div>
                      <span className={journey.stages.pickup.isComplete ? 'tr-badge-verified' : 'tr-badge-pending'}>
                        {journey.stages.pickup.isComplete ? (trT.verifiedStage || 'Verified') : (trT.notAvailableYet || 'Not available yet')}
                      </span>
                    </div>
                    {journey.stages.pickup.isComplete ? (
                      <div className="tr-data-grid">
                        <div>
                          <strong>{trT.pickupMethod || 'Method'}:</strong>{' '}
                          <span className="tr-pickup-method-tag">
                            {journey.stages.pickup.method === 'HUB' ? '🚚 Hub Pickup' : '🚜 Farm Pickup'}
                          </span>
                        </div>
                        <div><strong>Reason:</strong> {journey.stages.pickup.reason}</div>
                        <div><strong>Threshold:</strong> {journey.stages.pickup.thresholdKg} kg</div>
                      </div>
                    ) : (
                      <p className="tr-pending-text">{trT.notAvailableYet || 'Not available yet'}</p>
                    )}
                  </div>
                </div>

                {/* STAGE 5: AGGREGATED AT HUB */}
                <div className={`tr-stage-item ${journey.stages.hubAggregation.isComplete ? 'completed' : 'pending'}`}>
                  <div className="tr-stage-indicator">
                    <span className="tr-dot">{journey.stages.hubAggregation.isComplete ? '✓' : '○'}</span>
                    <div className="tr-line" />
                  </div>
                  <div className="tr-stage-card">
                    <div className="tr-stage-top">
                      <div className="tr-stage-title-wrap">
                        <span className="tr-stage-num">Stage 5</span>
                        <h4 className="tr-stage-name">🏢 {trT.hubAggregation || 'Aggregated at Hub'}</h4>
                      </div>
                      <span className={journey.stages.hubAggregation.isComplete ? 'tr-badge-verified' : 'tr-badge-pending'}>
                        {journey.stages.hubAggregation.isComplete ? (trT.verifiedStage || 'Verified') : (trT.notAvailableYet || 'Not available yet')}
                      </span>
                    </div>
                    {journey.stages.hubAggregation.isComplete ? (
                      <div className="tr-data-grid">
                        <div><strong>Hub Location:</strong> {journey.stages.hubAggregation.hubName}</div>
                        <div><strong>Total Hub Lot:</strong> {journey.stages.hubAggregation.totalQuantityKg} kg</div>
                        <div><strong>Contributing Farmers:</strong> {journey.stages.hubAggregation.farmerCount} farmers ({journey.stages.hubAggregation.listingCount} lots)</div>
                        <div><strong>Weighted Avg Rate:</strong> ₹{journey.stages.hubAggregation.averagePricePerKg}/kg</div>
                      </div>
                    ) : (
                      <p className="tr-pending-text">
                        {journey.stages.pickup.method === 'HOME'
                          ? 'Direct Farm Pickup — Hub aggregation bypassed for bulk volume'
                          : (trT.notAvailableYet || 'Not available yet — Awaiting hub lot pooling')}
                      </p>
                    )}
                  </div>
                </div>

                {/* STAGE 6: BUYER ORDER */}
                <div className={`tr-stage-item ${journey.stages.buyerOrder.isComplete ? 'completed' : 'pending'}`}>
                  <div className="tr-stage-indicator">
                    <span className="tr-dot">{journey.stages.buyerOrder.isComplete ? '✓' : '○'}</span>
                    <div className="tr-line" />
                  </div>
                  <div className="tr-stage-card">
                    <div className="tr-stage-top">
                      <div className="tr-stage-title-wrap">
                        <span className="tr-stage-num">Stage 6</span>
                        <h4 className="tr-stage-name">🛒 {trT.buyerOrder || 'Buyer Order'}</h4>
                      </div>
                      <span className={journey.stages.buyerOrder.isComplete ? 'tr-badge-verified' : 'tr-badge-pending'}>
                        {journey.stages.buyerOrder.isComplete ? (trT.verifiedStage || 'Verified') : (trT.notAvailableYet || 'Not available yet')}
                      </span>
                    </div>
                    {journey.stages.buyerOrder.isComplete ? (
                      <div className="tr-data-grid">
                        <div><strong>{trT.orderId || 'Order'}:</strong> #{journey.stages.buyerOrder.orderId}</div>
                        <div><strong>{trT.buyer || 'Buyer'}:</strong> {journey.stages.buyerOrder.buyerName}</div>
                        <div><strong>{trT.destination || 'Destination'}:</strong> {journey.stages.buyerOrder.buyerLocation}</div>
                        <div><strong>Volume:</strong> {journey.stages.buyerOrder.orderedQuantityKg} kg (₹{journey.stages.buyerOrder.totalAmount.toLocaleString('en-IN')})</div>
                      </div>
                    ) : (
                      <p className="tr-pending-text">
                        {trT.pendingOrder || 'Not available yet — Waiting for buyer order'}
                      </p>
                    )}
                  </div>
                </div>

                {/* STAGE 7: ROUTE OPTIMIZED */}
                <div className={`tr-stage-item ${journey.stages.route.isComplete ? 'completed' : 'pending'}`}>
                  <div className="tr-stage-indicator">
                    <span className="tr-dot">{journey.stages.route.isComplete ? '✓' : '○'}</span>
                    <div className="tr-line" />
                  </div>
                  <div className="tr-stage-card">
                    <div className="tr-stage-top">
                      <div className="tr-stage-title-wrap">
                        <span className="tr-stage-num">Stage 7</span>
                        <h4 className="tr-stage-name">🗺️ {trT.routeOptimized || 'Route Optimized'}</h4>
                      </div>
                      <span className={journey.stages.route.isComplete ? 'tr-badge-verified' : 'tr-badge-pending'}>
                        {journey.stages.route.isComplete ? (trT.verifiedStage || 'Verified') : (trT.notAvailableYet || 'Not available yet')}
                      </span>
                    </div>
                    {journey.stages.route.isComplete ? (
                      <div className="tr-data-grid">
                        <div><strong>{trT.stopNumber || 'Stop'}:</strong> Stop #{journey.stages.route.stopNumber}</div>
                        <div><strong>Destination:</strong> {journey.stages.route.destination}</div>
                        <div><strong>Leg Distance:</strong> {journey.stages.route.legDistanceKm} km</div>
                        <div><strong>Est. Transit:</strong> {journey.stages.route.estimatedMinutes} mins</div>
                      </div>
                    ) : (
                      <p className="tr-pending-text">
                        {trT.pendingRoute || 'Not available yet — Logistics dispatch sequence pending'}
                      </p>
                    )}
                  </div>
                </div>

                {/* STAGE 8: DELIVERY */}
                <div className={`tr-stage-item ${journey.stages.delivery.isComplete ? 'completed' : 'pending'}`}>
                  <div className="tr-stage-indicator">
                    <span className="tr-dot">{journey.stages.delivery.isComplete ? '✓' : '○'}</span>
                    <div className="tr-line" />
                  </div>
                  <div className="tr-stage-card">
                    <div className="tr-stage-top">
                      <div className="tr-stage-title-wrap">
                        <span className="tr-stage-num">Stage 8</span>
                        <h4 className="tr-stage-name">📦 {trT.delivery || 'Delivery'}</h4>
                      </div>
                      <span className={journey.stages.delivery.isComplete ? 'tr-badge-verified' : 'tr-badge-pending'}>
                        {journey.stages.delivery.isComplete ? (trT.verifiedStage || 'Verified') : (trT.notAvailableYet || 'Not available yet')}
                      </span>
                    </div>
                    {journey.stages.delivery.isComplete ? (
                      <div className="tr-delivery-delivered">
                        <span>✅ {escrowT.delivered || 'Delivered to buyer destination'}</span>
                      </div>
                    ) : journey.stages.delivery.inTransit ? (
                      <div className="tr-delivery-transit">
                        <span>🚚 {escrowT.inTransit || 'In Transit on delivery route'}</span>
                      </div>
                    ) : (
                      <p className="tr-pending-text">
                        {journey.stages.delivery.status
                          ? `Current: ${journey.stages.delivery.status.replace(/_/g, ' ')}`
                          : (trT.notAvailableYet || 'Not available yet')}
                      </p>
                    )}
                  </div>
                </div>

                {/* STAGE 9: ORDER & PAYMENT STATUS */}
                <div className={`tr-stage-item ${journey.stages.payment.isComplete ? 'completed' : 'pending'}`}>
                  <div className="tr-stage-indicator">
                    <span className="tr-dot">{journey.stages.payment.isComplete ? '✓' : '○'}</span>
                  </div>
                  <div className="tr-stage-card">
                    <div className="tr-stage-top">
                      <div className="tr-stage-title-wrap">
                        <span className="tr-stage-num">Stage 9</span>
                        <h4 className="tr-stage-name">💰 {trT.payment || 'Order & Payment Status'}</h4>
                      </div>
                      <span className={journey.stages.payment.isComplete ? 'tr-badge-verified' : 'tr-badge-pending'}>
                        {journey.stages.payment.isComplete ? (trT.paymentReleased || 'Payment Released') : (escrowT.paymentSecured || 'Payment Secured')}
                      </span>
                    </div>
                    {journey.stages.payment.amount ? (
                      <div className="tr-escrow-payment-box">
                        <div className="tr-epb-left">
                          <span className="tr-epb-icon">{journey.stages.payment.isComplete ? '🎉' : '🔒'}</span>
                          <div>
                            <span className="tr-epb-amount">₹{journey.stages.payment.amount.toLocaleString('en-IN')}</span>
                            <span className="tr-epb-label">
                              {journey.stages.payment.isComplete
                                ? (escrowT.paymentReleasedToFarmer || 'Payment Released to Farmer')
                                : (escrowT.securedBadge || 'Secured in Escrow')}
                            </span>
                          </div>
                        </div>
                        <span className="tr-sim-pill">{escrowT.simulatedEscrow || 'Simulated Escrow'}</span>
                      </div>
                    ) : (
                      <p className="tr-pending-text">{trT.notAvailableYet || 'Not available yet'}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useLanguage } from '../context/LanguageContext.jsx'
import {
  aggregateHubLots,
  getAllHubAggregations,
} from '../utils/aggregation.js'
import { getGradeBadgeStyle } from '../utils/quality.js'
import { IconPin, IconBasket } from '../components/Icons.jsx'
import { fetchListings } from '../utils/listingService.js'
import { CROP_KEYS, CROP_ICONS } from '../utils/cropConstants.js'

export default function HubAggregationPage({ _session, onNavigate }) {
  const { t } = useLanguage()
  const aggT = t.hubAggregation || {}
  const farmerT = t.farmerPortal || {}
  const qT = t.qualityCheck || {}

  // Selected crop tab ('all' or specific crop)
  const [selectedCrop, setSelectedCrop] = useState('all')

  // Read listings directly from localStorage with live backend fetch
  const [listings, setListings] = useState(() => {
    try {
      const raw = localStorage.getItem('sih_farmer_listings')
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    let isMounted = true
    fetchListings({ role: 'admin' })
      .then((items) => {
        if (isMounted && Array.isArray(items)) {
          setListings(items)
        }
      })
      .catch(() => {})
    return () => {
      isMounted = false
    }
  }, [])

  const allAggregations = getAllHubAggregations(listings)
  const currentAggregation = aggregateHubLots(listings, selectedCrop === 'all' ? null : selectedCrop)

  // Active crops that have hub lots
  const activeCropsWithHubLots = Object.keys(allAggregations).filter(
    (crop) => allAggregations[crop].totalQuantityKg > 0
  )

  return (
    <div className="hub-page">
      {/* Top Banner Header */}
      <div className="hub-top-bar">
        <div className="section-inner hub-top-inner">
          <div className="hub-title-block">
            <div className="hub-title-row">
              <span className="hub-hero-icon">🚚</span>
              <div>
                <h1 className="hub-main-title">{aggT.title || 'Hub Aggregation'}</h1>
                <p className="hub-subtitle">
                  {aggT.subtitle || 'Combined produce lots consolidated at the local agricultural collection hub.'}
                </p>
              </div>
            </div>
          </div>

          <div className="hub-nav-actions">
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
              onClick={() => onNavigate('/buyer')}
            >
              <IconBasket width="15" height="15" /> {aggT.btnBrowseMarket || 'Marketplace'}
            </button>
          </div>
        </div>
      </div>

      <div className="section-inner hub-main-content">
        {/* Hub logistics notice */}
        <div className="hub-notice-card">
          <span className="hub-notice-icon">ℹ️</span>
          <span>{aggT.hubNotice || 'Consolidated local hub aggregation enables shared logistics, bulk buyer contracts, and reduced per-kg transport overhead.'}</span>
        </div>

        {/* Crop Selector Tabs */}
        <div className="hub-crop-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={selectedCrop === 'all'}
            className={`hub-crop-tab ${selectedCrop === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedCrop('all')}
          >
            🌟 {aggT.tabAll || 'All Hub Lots'} ({activeCropsWithHubLots.length})
          </button>
          {CROP_KEYS.map((ck) => {
            const cropAgg = allAggregations[ck]
            const cropQty = cropAgg ? cropAgg.totalQuantityKg : 0
            const cropLabel = farmerT.crops?.[ck] || ck.charAt(0).toUpperCase() + ck.slice(1)
            return (
              <button
                key={ck}
                type="button"
                role="tab"
                aria-selected={selectedCrop === ck}
                className={`hub-crop-tab ${selectedCrop === ck ? 'active' : ''}`}
                onClick={() => setSelectedCrop(ck)}
              >
                <span>{CROP_ICONS[ck] || '🌱'}</span>
                <span>{cropLabel}</span>
                {cropQty > 0 && <span className="tab-qty-badge">{cropQty} kg</span>}
              </button>
            )
          })}
        </div>

        {/* ======================================================== */}
        {/* VIEW 1: ALL CROPS SUMMARY GRID */}
        {/* ======================================================== */}
        {selectedCrop === 'all' && (
          <div>
            {activeCropsWithHubLots.length === 0 ? (
              <div className="empty-hub-card">
                <div className="empty-hub-icon">📦</div>
                <h3>{aggT.noHubLotsTitle || 'No Aggregated Hub Lots for this Crop'}</h3>
                <p>{aggT.noHubLotsSubtitle || 'When farmers list produce within the hub threshold (Smart Pickup Decision: HUB), lots automatically aggregate here.'}</p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '16px' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onNavigate('/farmer')}
                  >
                    🧑‍🌾 {aggT.btnSellProduce || 'List More Produce'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => onNavigate('/buyer')}
                  >
                    🛒 {aggT.btnBrowseMarket || 'Browse Marketplace'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="hub-grid">
                {activeCropsWithHubLots.map((ck) => {
                  const item = allAggregations[ck]
                  const cropName = farmerT.crops?.[ck] || ck.charAt(0).toUpperCase() + ck.slice(1)
                  const icon = CROP_ICONS[ck] || '🌱'
                  return (
                    <div key={ck} className="hub-lot-card">
                      <div className="hub-lot-header">
                        <div className="hub-lot-title-group">
                          <span className="hub-lot-icon">{icon}</span>
                          <div>
                            <h3 className="hub-lot-crop-name">{cropName} {aggT.aggregatedLot || 'Hub Lot'}</h3>
                            <span className="hub-lot-tag">🚚 {aggT.title || 'Hub Aggregation'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="hub-metrics-grid">
                        <div className="hub-metric-box primary">
                          <span className="h-label">{aggT.totalQuantity || 'Total Quantity'}</span>
                          <span className="h-val">{item.totalQuantityKg} kg</span>
                        </div>
                        <div className="hub-metric-box">
                          <span className="h-label">{aggT.farmersContributing || 'Farmers'}</span>
                          <span className="h-val">{item.farmerCount}</span>
                        </div>
                        <div className="hub-metric-box">
                          <span className="h-label">{aggT.averageAskingPrice || 'Avg Asking'}</span>
                          <span className="h-val">₹{item.averagePricePerKg}{aggT.perKg || '/kg'}</span>
                        </div>
                        <div className="hub-metric-box">
                          <span className="h-label">{aggT.fairPriceBenchmark || 'AI Fair Benchmark'}</span>
                          <span className="h-val">₹{item.fairPricePerKg}{aggT.perKg || '/kg'}</span>
                        </div>
                      </div>

                      {/* Mini Quality Breakdown */}
                      <div className="hub-mini-quality">
                        <span className="hmq-title">{aggT.qualityBreakdown || 'Quality Breakdown'}:</span>
                        <div className="hmq-chips">
                          {item.qualityBreakdown.A > 0 && (
                            <span className="hmq-chip grade-a">
                              ● A: <strong>{item.qualityBreakdown.A} kg</strong>
                            </span>
                          )}
                          {item.qualityBreakdown.B > 0 && (
                            <span className="hmq-chip grade-b">
                              ● B: <strong>{item.qualityBreakdown.B} kg</strong>
                            </span>
                          )}
                          {item.qualityBreakdown.C > 0 && (
                            <span className="hmq-chip grade-c">
                              ● C: <strong>{item.qualityBreakdown.C} kg</strong>
                            </span>
                          )}
                          {item.qualityBreakdown.unassessed > 0 && (
                            <span className="hmq-chip grade-un">
                              ● {aggT.unassessed || 'Unassessed'}: <strong>{item.qualityBreakdown.unassessed} kg</strong>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="hub-card-actions">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm btn-view-lot"
                          onClick={() => setSelectedCrop(ck)}
                        >
                          🔍 View Detailed Breakdown
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* VIEW 2: SINGLE CROP DETAILED AGGREGATION VIEW */}
        {/* ======================================================== */}
        {selectedCrop !== 'all' && (
          <div className="hub-detail-view">
            {currentAggregation.totalQuantityKg === 0 ? (
              <div className="empty-hub-card">
                <div className="empty-hub-icon">📦</div>
                <h3>
                  {aggT.noHubLotsTitle || 'No Aggregated Hub Lots for this Crop'} (
                  {farmerT.crops?.[selectedCrop] || selectedCrop}
                  )
                </h3>
                <p>{aggT.noHubLotsSubtitle || 'When farmers list produce within the hub threshold (Smart Pickup Decision: HUB), lots automatically aggregate here.'}</p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '16px' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onNavigate('/farmer')}
                  >
                    🧑‍🌾 {aggT.btnSellProduce || 'List More Produce'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setSelectedCrop('all')}
                  >
                    ← {aggT.tabAll || 'All Hub Lots'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {/* Crop Header Summary Banner */}
                <div className="hub-crop-hero-banner">
                  <div className="hch-left">
                    <span className="hch-icon">{CROP_ICONS[selectedCrop] || '🌱'}</span>
                    <div>
                      <h2 className="hch-title">
                        {farmerT.crops?.[selectedCrop] || selectedCrop.charAt(0).toUpperCase() + selectedCrop.slice(1)}{' '}
                        {aggT.aggregatedLot || 'Hub Aggregated Lot'}
                      </h2>
                      <span className="hch-badge">🚚 {aggT.title || 'Hub Aggregation'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm btn-back-all"
                    onClick={() => setSelectedCrop('all')}
                  >
                    ← {aggT.tabAll || 'All Hub Lots'}
                  </button>
                </div>

                {/* 4 Key Statistics Cards */}
                <div className="hub-stats-overview-grid">
                  <div className="hub-stat-card highlight">
                    <span className="stat-card-label">{aggT.totalAggregatedQty || 'Total Aggregated Quantity'}</span>
                    <span className="stat-card-val primary">{currentAggregation.totalQuantityKg} kg</span>
                    <span className="stat-card-sub">
                      {currentAggregation.listingCount} {aggT.listingsCombined || 'listings combined'}
                    </span>
                  </div>

                  <div className="hub-stat-card">
                    <span className="stat-card-label">{aggT.farmersContributing || 'Farmers Contributing'}</span>
                    <span className="stat-card-val">{currentAggregation.farmerCount}</span>
                    <span className="stat-card-sub">Local Verified Farmers</span>
                  </div>

                  <div className="hub-stat-card">
                    <span className="stat-card-label">{aggT.averageAskingPrice || 'Average Asking Price'}</span>
                    <span className="stat-card-val">₹{currentAggregation.averagePricePerKg}{aggT.perKg || '/kg'}</span>
                    <span className="stat-card-sub">Quantity-Weighted Rate</span>
                  </div>

                  <div className="hub-stat-card benchmark">
                    <span className="stat-card-label">{aggT.fairPriceBenchmark || 'AI Fair Price Benchmark'}</span>
                    <span className="stat-card-val">₹{currentAggregation.fairPricePerKg}{aggT.perKg || '/kg'}</span>
                    <span className="stat-card-sub">Deterministic AI Guideline</span>
                  </div>
                </div>

                {/* Quality Breakdown Section */}
                <div className="hub-section-card quality-card">
                  <h3 className="section-card-title">
                    <span>🔬</span> {aggT.qualityBreakdown || 'Quality Breakdown'}
                  </h3>

                  <div className="grade-breakdown-grid">
                    <div className="grade-box grade-a">
                      <div className="g-header">
                        <span className="g-dot">●</span>
                        <span className="g-name">{aggT.gradeA || 'Grade A'}</span>
                      </div>
                      <div className="g-qty">{currentAggregation.qualityBreakdown.A} kg</div>
                      <div className="g-pct">
                        {currentAggregation.totalQuantityKg > 0
                          ? Math.round((currentAggregation.qualityBreakdown.A / currentAggregation.totalQuantityKg) * 100)
                          : 0}
                        % of total
                      </div>
                    </div>

                    <div className="grade-box grade-b">
                      <div className="g-header">
                        <span className="g-dot">●</span>
                        <span className="g-name">{aggT.gradeB || 'Grade B'}</span>
                      </div>
                      <div className="g-qty">{currentAggregation.qualityBreakdown.B} kg</div>
                      <div className="g-pct">
                        {currentAggregation.totalQuantityKg > 0
                          ? Math.round((currentAggregation.qualityBreakdown.B / currentAggregation.totalQuantityKg) * 100)
                          : 0}
                        % of total
                      </div>
                    </div>

                    <div className="grade-box grade-c">
                      <div className="g-header">
                        <span className="g-dot">●</span>
                        <span className="g-name">{aggT.gradeC || 'Grade C'}</span>
                      </div>
                      <div className="g-qty">{currentAggregation.qualityBreakdown.C} kg</div>
                      <div className="g-pct">
                        {currentAggregation.totalQuantityKg > 0
                          ? Math.round((currentAggregation.qualityBreakdown.C / currentAggregation.totalQuantityKg) * 100)
                          : 0}
                        % of total
                      </div>
                    </div>

                    {currentAggregation.qualityBreakdown.unassessed > 0 && (
                      <div className="grade-box grade-un">
                        <div className="g-header">
                          <span className="g-dot">●</span>
                          <span className="g-name">{aggT.unassessed || 'Unassessed'}</span>
                        </div>
                        <div className="g-qty">{currentAggregation.qualityBreakdown.unassessed} kg</div>
                        <div className="g-pct">
                          {currentAggregation.totalQuantityKg > 0
                            ? Math.round(
                                (currentAggregation.qualityBreakdown.unassessed /
                                  currentAggregation.totalQuantityKg) *
                                  100
                              )
                            : 0}
                          % of total
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Contributing Farmers Table (Privacy-Preserved) */}
                <div className="hub-section-card contributors-card">
                  <h3 className="section-card-title">
                    <span>🧑‍🌾</span> {aggT.contributingFarmers || 'Contributing Farmers'} (
                    {currentAggregation.contributors.length})
                  </h3>

                  <div className="contributors-table-wrap">
                    <table className="contributors-table">
                      <thead>
                        <tr>
                          <th>{aggT.farmerCol || 'Farmer'}</th>
                          <th>{aggT.locationCol || 'Location'}</th>
                          <th>{aggT.lotQtyCol || 'Lot Size'}</th>
                          <th>{aggT.askingRateCol || 'Asking Rate'}</th>
                          <th>{aggT.gradeCol || 'Quality Grade'}</th>
                          <th>{aggT.harvestDateCol || 'Harvest Date'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentAggregation.contributors.map((contrib, idx) => {
                          const badgeStyle = getGradeBadgeStyle(contrib.grade)
                          return (
                            <tr key={contrib.listingId || idx}>
                              <td className="c-farmer">
                                <div className="c-farmer-row">
                                  <span className="c-farmer-icon">🧑‍🌾</span>
                                  <span className="c-farmer-name">{contrib.farmerName}</span>
                                </div>
                              </td>
                              <td className="c-loc">
                                <div className="c-loc-row">
                                  <IconPin width="12" height="12" />
                                  <span>{contrib.location}</span>
                                </div>
                              </td>
                              <td className="c-qty">
                                <strong>{contrib.quantityKg} kg</strong>
                              </td>
                              <td className="c-price">
                                <span>₹{contrib.pricePerKg}{aggT.perKg || '/kg'}</span>
                              </td>
                              <td className="c-grade">
                                {contrib.grade !== 'Unassessed' ? (
                                  <span
                                    className="produce-quality-tag"
                                    style={{
                                      backgroundColor: badgeStyle.bg,
                                      color: badgeStyle.color,
                                      border: `1px solid ${badgeStyle.border}`,
                                      fontSize: '0.75rem',
                                      padding: '2px 8px',
                                      margin: 0,
                                    }}
                                  >
                                    ● {qT[`grade${contrib.grade}`] || `Grade ${contrib.grade}`}
                                    {contrib.qualityScore ? ` (${contrib.qualityScore})` : ''}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                                    {aggT.unassessed || 'Unassessed'}
                                  </span>
                                )}
                              </td>
                              <td className="c-date">
                                <span>{contrib.harvestDate || '—'}</span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

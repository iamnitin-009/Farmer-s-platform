import { useState, useEffect, useRef } from 'react'
import { useLanguage } from '../context/LanguageContext.jsx'
import { IconSprout, IconPin, IconTag } from './Icons.jsx'
import { getGradeBadgeStyle } from '../utils/quality.js'
import { compressImage } from '../utils/imageCompressor.js'
import { calculateFairPrice } from '../utils/fairPrice.js'
import { findBuyerMatches } from '../utils/buyerMatching.js'
import { getPickupDecision } from '../utils/pickupDecision.js'
import { isEligibleForHubListing } from '../utils/aggregation.js'
import { getFarmerOrders, advanceOrderStatus } from '../utils/auth.js'
import { getStepIndex } from '../utils/paymentEscrow.js'
import { ensureListingTraceabilityId, generateQrDataUrl, getTraceabilityUrl } from '../utils/traceability.js'
import { predictCropDemand, fetchDemandPrediction, getDemandBadgeStyle } from '../utils/demandPrediction.js'
import { fetchListings, createListing as apiCreateListing, deleteListing as apiDeleteListing } from '../utils/listingService.js'
import { CROP_KEYS, getCropVarieties } from '../utils/cropConstants.js'

const STORAGE_KEY = 'sih_farmer_listings'

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

export default function FarmerPortal({ onNavigate, session, onLogout }) {
  const { t, lang } = useLanguage()
  const portalT = t.farmerPortal
  const authT = t.auth
  const qT = t.qualityCheck || {}
  const fpT = t.fairPrice || {}
  const bmT = t.buyerMatching || {}
  const pkT = t.pickupDecision || {}
  const aggT = t.hubAggregation || {}
  const escrowT = t.paymentEscrow || {}
  const trT = t.traceability || {}
  const dpT = t.demandPrediction || {}

  // Incoming buyer orders state for this farmer
  const [farmerOrders, setFarmerOrders] = useState(() => {
    return session?.id ? getFarmerOrders(session.id, session.mobile) : []
  })

  const refreshFarmerOrders = async () => {
    if (!session?.id) return
    const local = getFarmerOrders(session.id, session.mobile) || []
    try {
      const res = await fetch(`/api/orders?farmerId=${encodeURIComponent(session.id)}`)
      if (res.ok) {
        const data = await res.json()
        const serverOrders = data.orders || (Array.isArray(data) ? data : [])
        if (Array.isArray(serverOrders) && serverOrders.length > 0) {
          const serverIds = new Set(serverOrders.map((o) => o.id || o.orderId))
          const filteredLocal = local.filter((o) => !serverIds.has(o.id || o.orderId))
          setFarmerOrders([...serverOrders, ...filteredLocal])
          return
        }
      }
    } catch (e) {
      console.warn('Could not fetch server orders:', e)
    }
    setFarmerOrders(local)
  }

  useEffect(() => {
    refreshFarmerOrders()
  }, [session])

  const handleAdvanceFarmerOrder = (orderId) => {
    const res = advanceOrderStatus(orderId)
    if (res.success) {
      refreshFarmerOrders()
    }
  }

  const handleAcceptAllocation = async (allocationId) => {
    try {
      const res = await fetch(`/api/allocations/${encodeURIComponent(allocationId)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ farmerId: session?.id }),
      })
      const result = await res.json()
      if (result.success) {
        refreshFarmerOrders()
        fetchListings({ role: 'farmer' }, session).then((sl) => {
          if (Array.isArray(sl)) setListings(sl)
        }).catch(() => {})
      } else {
        alert(result.error || 'Failed to accept allocation')
      }
    } catch (err) {
      console.error(err)
      alert('Network error accepting allocation')
    }
  }

  const handleRejectAllocation = async (allocationId) => {
    if (!window.confirm(lang === 'hi' ? 'क्या आप इस मांग आवंटन को अस्वीकार करना चाहते हैं? बची हुई मांग अन्य किसानों को पुनः आवंटित कर दी जाएगी।' : 'Are you sure you want to reject this allocation? The demand will be reallocated to the next available farmer.')) {
      return
    }
    try {
      const res = await fetch(`/api/allocations/${encodeURIComponent(allocationId)}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ farmerId: session?.id, reason: 'Farmer declined' }),
      })
      const result = await res.json()
      if (result.success) {
        refreshFarmerOrders()
        fetchListings({ role: 'farmer' }, session).then((sl) => {
          if (Array.isArray(sl)) setListings(sl)
        }).catch(() => {})
      } else {
        alert(result.error || 'Failed to reject allocation')
      }
    } catch (err) {
      console.error(err)
      alert('Network error rejecting allocation')
    }
  }

  // Buyer Matching state
  const [recentListing, setRecentListing] = useState(null)
  const [activeMatchesListing, setActiveMatchesListing] = useState(null)
  const [inspectingBuyerMatch, setInspectingBuyerMatch] = useState(null)
  const [sentOffers, setSentOffers] = useState({})
  const [offerToast, setOfferToast] = useState(null)

  const handleSendOffer = (match, targetListing) => {
    const listingRef = targetListing || recentListing || activeMatchesListing
    setSentOffers((prev) => ({ ...prev, [match.id]: true }))
    setOfferToast({
      buyerName: match.buyerName,
      qty: match.quantity,
      price: listingRef ? (listingRef.price ?? listingRef.expectedPrice) : match.offeredPrice,
    })
    setTimeout(() => {
      setOfferToast(null)
    }, 5000)
  }

  // AI Quality Check state
  const [qualityResult, setQualityResult] = useState(null)
  const [isAnalyzingQuality, setIsAnalyzingQuality] = useState(false)
  const [qualityStatus, setQualityStatus] = useState('idle') // 'idle' | 'analyzing' | 'assessed' | 'unsuitable' | 'error'
  const [qualityError, setQualityError] = useState(null)
  const [unsuitableInfo, setUnsuitableInfo] = useState(null)

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
      title: portalT.crops[itemOrOrder.crop] || itemOrOrder.crop,
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

  // Listings state initialized from localStorage with legacy migration
  const [listings, setListings] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      const parsed = saved ? JSON.parse(saved) : []
      let changed = false
      const migrated = parsed.map((item) => {
        let updated = item
        if (session?.id && !updated.farmerId) {
          changed = true
          updated = { ...updated, farmerId: session.id, farmerName: session.name }
        }
        if (!updated.traceabilityId) {
          ensureListingTraceabilityId(updated)
          changed = true
        }
        return updated
      })
      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      }
      return migrated
    } catch {
      return []
    }
  })

  // Form state - pre-fill location from farmer profile if available
  const [crop, setCrop] = useState('')
  const [variety, setVariety] = useState('')
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [location, setLocation] = useState(session?.location || '')
  const [harvestDate, setHarvestDate] = useState('')
  const [photo, setPhoto] = useState(null)
  const [photoName, setPhotoName] = useState('')
  const [priceApplied, setPriceApplied] = useState(false)

  const availableVarieties = crop ? getCropVarieties(crop) : []

  // Deterministic AI Fair Price calculation based on crop baseline, grade, and volume
  const fairPriceResult = crop
    ? calculateFairPrice({
        crop,
        quantity,
        grade: qualityResult?.grade,
        lang,
      })
    : null

  // Deterministic Smart Pickup Decision calculation based on crop and quantity thresholds
  const pickupDecision = crop && quantity
    ? getPickupDecision(crop, quantity, lang)
    : null

  // 7-Day Demand Forecast calculation with live backend sync & reliable local fallback
  const [liveDemandPrediction, setLiveDemandPrediction] = useState(null)

  useEffect(() => {
    if (!crop) {
      setLiveDemandPrediction(null)
      return
    }
    let isCurrent = true
    fetchDemandPrediction({ crop, lang }).then((pred) => {
      if (isCurrent && pred) {
        setLiveDemandPrediction(pred)
      }
    }).catch(() => {})
    return () => { isCurrent = false }
  }, [crop, lang])

  const demandPrediction = liveDemandPrediction || (crop ? predictCropDemand({ crop, lang }) : null)

  const handleApplyFairPrice = () => {
    if (fairPriceResult?.suggestedPrice) {
      setPrice(String(fairPriceResult.suggestedPrice))
      setPriceApplied(true)
      if (errors.price) {
        setErrors((prev) => ({ ...prev, price: undefined }))
      }
    }
  }

  // Validation & UI states
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  const fileInputRef = useRef(null)
  const successRef = useRef(null)

  // Synchronize listings to localStorage on change
  useEffect(() => {
    try {
      const unique = Array.from(new Map(listings.map((item) => [item.id, item])).values())
      localStorage.setItem(STORAGE_KEY, JSON.stringify(unique))
    } catch (err) {
      console.error('Error saving listings to localStorage:', err)
    }
  }, [listings])

  // Fetch fresh shared listings from backend upon mounting
  useEffect(() => {
    let isMounted = true
    fetchListings({ role: 'farmer' }, session)
      .then((serverListings) => {
        if (isMounted && Array.isArray(serverListings) && serverListings.length > 0) {
          setListings(serverListings)
        }
      })
      .catch(() => {})
    return () => {
      isMounted = false
    }
  }, [session])

  // Handle image upload with live preview
  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Limit to reasonable client image size (~5MB) for upload
    if (file.size > 5 * 1024 * 1024) {
      alert(lang === 'hi' ? 'कृपया 5MB से कम आकार की तस्वीर चुनें।' : 'Please choose an image under 5MB.')
      return
    }

    setPhotoName(file.name)
    // Reset previous quality check on new photo selection
    setQualityResult(null)
    setQualityStatus('idle')
    setQualityError(null)
    setUnsuitableInfo(null)

    const reader = new FileReader()
    reader.onloadend = () => {
      setPhoto(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const handleRemovePhoto = () => {
    setPhoto(null)
    setPhotoName('')
    setQualityResult(null)
    setQualityStatus('idle')
    setQualityError(null)
    setUnsuitableInfo(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Trigger AI Produce Quality Check via Groq Vision
  const handleAnalyzeQuality = async () => {
    if (!crop.trim()) {
      setErrors((prev) => ({ ...prev, crop: portalT.validation.cropRequired }))
      return
    }
    if (!photo) return

    setIsAnalyzingQuality(true)
    setQualityStatus('analyzing')
    setQualityError(null)
    setUnsuitableInfo(null)

    try {
      const res = await fetch('/api/quality-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          crop,
          image: photo,
          mimeType: photo.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        setQualityStatus('error')
        const errMsg = (data.code === 'GROQ_JSON_VALIDATION_FAILED' && lang === 'hi')
          ? 'AI गुणवत्ता निरीक्षण मॉडल समय पर पूर्ण नहीं हो सका। कृपया पुनः प्रयास करें।'
          : (data.error || 'Failed to analyze produce quality.')
        setQualityError(errMsg)
        return
      }

      if (data.status === 'UNSUITABLE') {
        setQualityStatus('unsuitable')
        setUnsuitableInfo({
          message: data.message,
          observations: data.observations || [],
        })
        setQualityResult(null)
      } else {
        // ASSESSED: deterministic grade already calculated and verified server-side
        setQualityResult({
          score: data.qualityScore,
          grade: data.grade,
          confidence: data.confidence,
          observations: data.observations || [],
          assessedAt: data.assessedAt,
          model: data.model,
        })
        setQualityStatus('assessed')
      }
    } catch (err) {
      console.error('Quality check network error:', err)
      setQualityStatus('error')
      setQualityError(
        lang === 'hi'
          ? 'नेटवर्क त्रुटि: AI गुणवत्ता निरीक्षण सेवा से संपर्क नहीं हो सका। कृपया जांचें कि बैकएंड सर्वर सक्रिय है।'
          : 'Network error: Could not reach AI quality inspection server. Please ensure backend server is running.'
      )
    } finally {
      setIsAnalyzingQuality(false)
    }
  }

  // Validate form fields
  const validateForm = () => {
    const newErrors = {}

    if (!crop.trim()) {
      newErrors.crop = portalT.validation.cropRequired
    }

    const qtyNum = parseFloat(quantity)
    if (!quantity || isNaN(qtyNum) || qtyNum <= 0) {
      newErrors.quantity = portalT.validation.quantityRequired
    }

    const priceNum = parseFloat(price)
    if (!price || isNaN(priceNum) || priceNum <= 0) {
      newErrors.price = portalT.validation.priceRequired
    }

    if (!location.trim()) {
      newErrors.location = portalT.validation.locationRequired
    }

    if (!harvestDate.trim()) {
      newErrors.harvestDate = portalT.validation.harvestDateRequired
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Form submission handler
  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)

    // Compress photo before saving to localStorage to prevent quota limits
    let compressedPhoto = photo
    if (photo) {
      try {
        compressedPhoto = await compressImage(photo)
      } catch (err) {
        console.warn('Image compression fallback:', err)
      }
    }

    const newListing = {
      id: 'listing_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      farmerId: session?.id || 'demo_farmer',
      farmerName: session?.name || 'Farmer',
      farmerMobile: session?.mobile || '',
      crop,
      variety: variety || 'Regular',
      quantity: parseFloat(quantity),
      price: parseFloat(price),
      location: location.trim(),
      harvestDate,
      photo: compressedPhoto,
      quality: qualityResult ? { ...qualityResult } : null,
      fairPrice: fairPriceResult
        ? {
            suggestedPrice: fairPriceResult.suggestedPrice,
            minPrice: fairPriceResult.minPrice,
            maxPrice: fairPriceResult.maxPrice,
            grade: fairPriceResult.grade,
            basePrice: fairPriceResult.basePrice,
          }
        : null,
      pickupDecision: pickupDecision && pickupDecision.method
        ? {
            method: pickupDecision.method,
            thresholdKg: pickupDecision.thresholdKg,
            quantityKg: pickupDecision.quantityKg,
            reason: pickupDecision.reason,
          }
        : null,
      status: 'Listed',
      createdAt: new Date().toISOString(),
    }

    // Ensure stable unique traceability ID for this listing
    ensureListingTraceabilityId(newListing)

    // Save to shared backend & update state
    apiCreateListing(newListing, session).catch((err) => {
      console.warn('Backend createListing notice:', err)
    })
    setListings((prev) => [newListing, ...prev.filter((l) => l.id !== newListing.id)])
    setRecentListing(newListing)

    // Reset form fields
    setCrop('')
    setVariety('')
    setQuantity('')
    setPrice('')
    setLocation(session?.location || '')
    setHarvestDate('')
    setPhoto(null)
    setPhotoName('')
    setPriceApplied(false)
    setQualityResult(null)
    setQualityStatus('idle')
    setQualityError(null)
    setUnsuitableInfo(null)
    setErrors({})
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }

    setIsSubmitting(false)
    setShowSuccess(true)

    // Smooth scroll to feedback message
    setTimeout(() => {
      successRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 100)
  }

  // Delete listing handler
  const handleDeleteListing = (id) => {
    if (window.confirm(portalT.confirmDelete)) {
      setListings((prev) => prev.filter((item) => item.id !== id))
      apiDeleteListing(id, session).catch((err) => {
        console.warn('Backend deleteListing notice:', err)
      })
    }
  }

  // Filter listings strictly belonging to current logged-in user
  const myListings = listings.filter(
    (item) => !item.farmerId || item.farmerId === session?.id || (session?.mobile && item.farmerMobile === session.mobile)
  )

  return (
    <div className="farmer-portal">
      {/* Top Breadcrumb / Session Bar */}
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
              {portalT.backToHome}
            </button>
          </div>

          <div className="farmer-nav-right">
            {session && (
              <div className="session-farmer-info">
                <span className="session-farmer-name">
                  {authT.loggedInAs}: <strong>{session.name}</strong>
                  {session.location ? ` • ${session.location}` : ''}
                </span>
                <button
                  type="button"
                  className="btn-logout"
                  onClick={onLogout}
                  title={authT.logout}
                >
                  {authT.logout}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="section-inner farmer-main-container">
        {/* Page Title & Subtitle */}
        <header className="farmer-page-header">
          <h1>{portalT.title}</h1>
          <p className="section-subheading">{portalT.subtitle}</p>
        </header>

        {/* Success Banner */}
        {showSuccess && (
          <div className="alert-success" ref={successRef} role="alert">
            <div className="alert-success-icon">✓</div>
            <div className="alert-success-content">
              <h4>{portalT.successHeading}</h4>
              <p>{portalT.successMessage}</p>
            </div>
            <button
              className="alert-close-btn"
              type="button"
              onClick={() => setShowSuccess(false)}
              aria-label="Dismiss alert"
            >
              ×
            </button>
          </div>
        )}

        {/* Offer Sent Feedback Banner */}
        {offerToast && (
          <div className="offer-toast-banner" role="status">
            <span>
              ✓{' '}
              {bmT.offerSuccessMsg
                ? bmT.offerSuccessMsg
                    .replace('{qty}', offerToast.qty)
                    .replace('{price}', offerToast.price)
                    .replace('{buyer}', offerToast.buyerName)
                : `Offer of ${offerToast.qty} kg at ₹${offerToast.price}/kg submitted to ${offerToast.buyerName}!`}
            </span>
            <button
              type="button"
              className="alert-close-btn"
              onClick={() => setOfferToast(null)}
              style={{ color: '#166534' }}
            >
              ×
            </button>
          </div>
        )}

        {/* Recent Listing Buyer Matches Section */}
        {recentListing && (() => {
          const recentMatches = findBuyerMatches({
            listing: recentListing,
            currentUserId: session?.id,
            lang,
          })
          const cropName = portalT.crops[recentListing.crop] || recentListing.crop

          return (
            <div className="buyer-matches-section">
              <div className="buyer-matches-header">
                <div className="matches-title-group">
                  <h3>
                    <span>🤝</span>
                    <span>
                      {bmT.sectionTitle || 'Best Buyer Matches'} — {cropName} ({recentListing.quantity} kg)
                    </span>
                  </h3>
                  <p className="matches-subheading">
                    {bmT.sectionSubtitle ||
                      'AI ranked potential buyers based on crop demand, volume, price, proximity, and quality.'}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-dismiss-matches"
                  onClick={() => setRecentListing(null)}
                  title="Dismiss matches"
                  aria-label="Dismiss matches"
                >
                  ×
                </button>
              </div>

              {recentMatches.length === 0 ? (
                <div className="empty-matches-notice">
                  <div className="empty-matches-icon">🔍</div>
                  <h4>{bmT.noMatchesTitle || 'No Buyer Demand Found Yet'}</h4>
                  <p>
                    {bmT.noMatchesSubtitle ||
                      'When buyers place orders or express demand for this crop on the marketplace, top matching buyers will automatically appear here.'}
                  </p>
                </div>
              ) : (
                <div className="buyer-matches-grid">
                  {recentMatches.map((match) => {
                    const isSent = !!sentOffers[match.id]
                    const scoreClass =
                      match.matchScore >= 85
                        ? 'score-green'
                        : match.matchScore >= 70
                        ? 'score-amber'
                        : 'score-blue'

                    return (
                      <div
                        key={match.id}
                        className={`buyer-match-card ${
                          match.matchScore >= 85 ? 'high-match' : match.matchScore >= 70 ? 'medium-match' : ''
                        }`}
                      >
                        <div className="match-card-top">
                          <div className="match-buyer-info">
                            <h4>{match.buyerName}</h4>
                            <span className="match-buyer-loc">📍 {match.buyerLocation}</span>
                          </div>
                          <span className={`match-score-badge ${scoreClass}`}>
                            ● {match.matchScore}% {bmT.matchScore || 'Match'}
                          </span>
                        </div>

                        <div className="match-metrics-grid">
                          <div className="match-metric-item">
                            <span className="m-metric-label">{bmT.requiredQty || 'Required Qty'}</span>
                            <span className="m-metric-val">{match.quantity} kg</span>
                          </div>
                          <div className="match-metric-item">
                            <span className="m-metric-label">{bmT.offeredPrice || 'Offered Price'}</span>
                            <span className="m-metric-val">₹{match.offeredPrice}/kg</span>
                          </div>
                        </div>

                        <span className="match-distance-tag">
                          🚚 {match.distanceEstimate}
                        </span>

                        <ul className="match-reasons-list">
                          {match.reasons.map((reason, idx) => (
                            <li key={idx}>
                              <span className="reason-check">✓</span>
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>

                        <div className="match-card-actions">
                          <button
                            type="button"
                            className={`btn-send-offer ${isSent ? 'sent' : ''}`}
                            onClick={() => !isSent && handleSendOffer(match, recentListing)}
                            disabled={isSent}
                          >
                            {isSent ? `✓ ${bmT.offerSent || 'Offer Sent'}` : `📤 ${bmT.btnSendOffer || 'Send Offer'}`}
                          </button>
                          <button
                            type="button"
                            className="btn-view-buyer-details"
                            onClick={() => setInspectingBuyerMatch({ match, listing: recentListing })}
                            title={bmT.btnViewBuyer || 'Buyer Details'}
                          >
                            ℹ️
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}

        <div className="farmer-content-layout">
          {/* Produce Listing Form */}
          <section className="farmer-form-section">
            <div className="farmer-form-card">
              <div className="form-header">
                <span className="form-icon-wrap">
                  <IconSprout />
                </span>
                <div>
                  <h2>{portalT.formHeading}</h2>
                  <p className="form-subheading-text">{portalT.formSubheading}</p>
                </div>
              </div>

              <form onSubmit={handleSubmit} noValidate>
                <div className="form-grid">
                  {/* Crop Dropdown */}
                  <div className="form-group full-width">
                    <label htmlFor="cropSelect" className="form-label">
                      {portalT.cropLabel} <span className="req">*</span>
                    </label>
                    <select
                      id="cropSelect"
                      className={`form-input form-select ${errors.crop ? 'input-error' : ''}`}
                      value={crop}
                      onChange={(e) => {
                        const newCrop = e.target.value
                        setCrop(newCrop)
                        const vars = getCropVarieties(newCrop)
                        setVariety(vars[0] || 'Regular')
                        if (errors.crop) setErrors((prev) => ({ ...prev, crop: undefined }))
                      }}
                    >
                      <option value="">{portalT.cropPlaceholder}</option>
                      {CROP_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {portalT.crops[key]}
                        </option>
                      ))}
                    </select>
                    {errors.crop && <span className="form-error">{errors.crop}</span>}
                  </div>

                  {/* Variety Dropdown (BFM-001 / CROP-001) */}
                  {availableVarieties.length > 0 && (
                    <div className="form-group full-width">
                      <label htmlFor="varietySelect" className="form-label">
                        {portalT.varietyLabel || (lang === 'hi' ? 'किस्म (Variety)' : 'Variety')} <span className="req">*</span>
                      </label>
                      <select
                        id="varietySelect"
                        className="form-input form-select"
                        value={variety}
                        onChange={(e) => setVariety(e.target.value)}
                      >
                        {availableVarieties.map((v) => (
                          <option key={v} value={v}>
                            {portalT.varieties?.[v] || v}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Quantity */}
                  <div className="form-group">
                    <label htmlFor="quantityInput" className="form-label">
                      {portalT.quantityLabel} <span className="req">*</span>
                    </label>
                    <input
                      id="quantityInput"
                      type="number"
                      min="1"
                      step="any"
                      placeholder={portalT.quantityPlaceholder}
                      className={`form-input ${errors.quantity ? 'input-error' : ''}`}
                      value={quantity}
                      onChange={(e) => {
                        setQuantity(e.target.value)
                        if (errors.quantity) setErrors((prev) => ({ ...prev, quantity: undefined }))
                      }}
                    />
                    {errors.quantity && <span className="form-error">{errors.quantity}</span>}
                  </div>

                  {/* Expected Price per kg */}
                  <div className="form-group">
                    <label htmlFor="priceInput" className="form-label">
                      {portalT.priceLabel} <span className="req">*</span>
                    </label>
                    <input
                      id="priceInput"
                      type="number"
                      min="1"
                      step="any"
                      placeholder={portalT.pricePlaceholder}
                      className={`form-input ${errors.price ? 'input-error' : ''}`}
                      value={price}
                      onChange={(e) => {
                        setPrice(e.target.value)
                        setPriceApplied(false)
                        if (errors.price) setErrors((prev) => ({ ...prev, price: undefined }))
                      }}
                    />
                    {errors.price && <span className="form-error">{errors.price}</span>}
                  </div>

                  {/* AI Fair Price Suggestion Box */}
                  <div className="form-group full-width">
                    {fairPriceResult ? (
                      <div className="fair-price-box">
                        <div className="fair-price-header">
                          <div className="fair-price-title">
                            <span className="fair-price-sparkle">✨</span>
                            <span>{fpT.title || 'AI Fair Price Suggestion'}</span>
                          </div>
                          <span className="fair-price-range-tag">
                            {fpT.marketRange || 'Market Range'}: ₹{fairPriceResult.minPrice} - ₹{fairPriceResult.maxPrice} / kg
                          </span>
                        </div>

                        <div className="fair-price-body">
                          <div className="fair-price-row">
                            <div className="fair-price-main">
                              <span className="fair-price-rate">₹{fairPriceResult.suggestedPrice}</span>
                              <span className="fair-price-unit">/ kg</span>
                            </div>

                            <button
                              type="button"
                              className={`btn-use-fair-price ${priceApplied ? 'applied' : ''}`}
                              onClick={handleApplyFairPrice}
                              title={fpT.useSuggested || 'Use Suggested Price'}
                            >
                              {priceApplied ? (
                                <>✓ {fpT.priceApplied || 'Price applied to listing'}</>
                              ) : (
                                <>💡 {fpT.useSuggested || 'Use Suggested Price'}</>
                              )}
                            </button>
                          </div>

                          <div className="fair-price-explanation">
                            {fairPriceResult.explanation}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="fair-price-box-prompt">
                        <span>💡</span>
                        <span>{fpT.cropPrompt || 'Select a crop above to see AI fair price suggestion'}</span>
                      </div>
                    )}
                  </div>

                  {/* Smart Pickup Decision Recommendation Card */}
                  <div className="form-group full-width">
                    {pickupDecision && pickupDecision.method ? (
                      <div className={`pickup-decision-card ${pickupDecision.method === 'HUB' ? 'decision-hub' : 'decision-home'}`}>
                        <div className="pickup-decision-header">
                          <div className="pickup-title-row">
                            <span className="pickup-icon">{pickupDecision.icon}</span>
                            <div>
                              <div className="pickup-heading-text">{pkT.title || 'Smart Pickup Decision'}</div>
                              <div className="pickup-recommendation">
                                {pickupDecision.method === 'HUB'
                                  ? (pkT.recHub || 'Recommended: HUB PICKUP')
                                  : (pkT.recHome || 'Recommended: HOME/FARM PICKUP')}
                              </div>
                            </div>
                          </div>
                          <span className={`pickup-method-pill ${pickupDecision.method === 'HUB' ? 'pill-hub' : 'pill-home'}`}>
                            {pickupDecision.label}
                          </span>
                        </div>

                        <div className="pickup-decision-body">
                          <div className="pickup-stats-row">
                            <div className="pickup-stat-box">
                              <span className="p-stat-label">{pkT.yourQty || 'Your Quantity'}</span>
                              <span className="p-stat-val">{pickupDecision.quantityKg} kg</span>
                            </div>
                            <div className="pickup-stat-box">
                              <span className="p-stat-label">{pkT.hubThreshold || 'Hub Threshold'}</span>
                              <span className="p-stat-val">{pickupDecision.thresholdKg} kg</span>
                            </div>
                          </div>
                          <div className="pickup-reason-box">
                            <strong>{pkT.reasonLabel || 'Reason'}:</strong> {pickupDecision.reason}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="pickup-prompt-box">
                        <span>🚚</span>
                        <span>{pkT.prompt || 'Select crop and enter quantity to see smart pickup recommendation'}</span>
                      </div>
                    )}
                  </div>


                  {/* 7-Day Demand Forecast Card */}
                  <div className="form-group full-width">
                    {demandPrediction && demandPrediction.cropKey !== 'unknown' ? (
                      <div className="demand-prediction-card">
                        <div className="demand-card-header">
                          <div className="demand-title-row">
                            <span className="demand-icon">📈</span>
                            <div>
                              <div className="demand-heading-text">{dpT.title || '7-Day Demand Forecast'}</div>
                              <div className="demand-crop-subtitle">
                                {portalT.crops?.[demandPrediction.cropKey] || demandPrediction.crop} • {dpT.horizonLabel || 'Next 7 Days'}
                              </div>
                            </div>
                          </div>
                          <span
                            className="demand-level-pill"
                            style={{
                              backgroundColor: getDemandBadgeStyle(demandPrediction.demandLevel).bg,
                              color: getDemandBadgeStyle(demandPrediction.demandLevel).color,
                              borderColor: getDemandBadgeStyle(demandPrediction.demandLevel).border,
                            }}
                          >
                            ● {demandPrediction.demandLevel === 'HIGH'
                                ? (dpT.highDemand || 'High Demand')
                                : demandPrediction.demandLevel === 'MEDIUM'
                                  ? (dpT.mediumDemand || 'Medium Demand')
                                  : (dpT.lowDemand || 'Low Demand')}
                          </span>
                        </div>

                        <div className="demand-card-body">
                          <div className="demand-stats-row">
                            <div className="demand-stat-box">
                              <span className="d-stat-label">{dpT.predictedDemand || 'Predicted Demand (7 Days)'}</span>
                              <span className="d-stat-val">
                                {demandPrediction.predictedDemand || demandPrediction.predictedDemandKg} kg
                              </span>
                            </div>
                            <div className="demand-stat-box">
                              <span className="d-stat-label">{dpT.trend || 'Demand Trend'}</span>
                              <span className={`d-stat-val ${demandPrediction.trendPercent > 0 ? 'trend-up' : demandPrediction.trendPercent < 0 ? 'trend-down' : ''}`}>
                                {demandPrediction.trendPercent > 0 ? `+${demandPrediction.trendPercent}%` : `${demandPrediction.trendPercent}%`}
                              </span>
                            </div>
                            <div className="demand-stat-box">
                              <span className="d-stat-label">{dpT.confidence || 'Confidence'}</span>
                              <span className="d-stat-val">{demandPrediction.confidence}%</span>
                            </div>
                          </div>

                          {demandPrediction.dataSource === 'baseline_estimate' && (
                            <div className="demand-baseline-notice" style={{ fontSize: '0.8rem', color: '#64748b', backgroundColor: '#f8fafc', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', marginTop: '6px' }}>
                              ℹ️ {dpT.baselineNotice || 'Baseline estimate — limited platform order history'}
                            </div>
                          )}

                          <div className="demand-explanation-box">
                            <p className="demand-explanation-text">{demandPrediction.explanation}</p>
                            <p className="demand-rec-text">
                              <strong>💡 {dpT.recommendationLabel || 'Recommendation'}:</strong> {demandPrediction.recommendation}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="demand-prompt-box">
                        <span>📈</span>
                        <span>{dpT.selectCropPrompt || 'Select a crop above to see 7-day demand forecast'}</span>
                      </div>
                    )}
                  </div>

                  {/* Farm / Pickup Location */}
                  <div className="form-group full-width">
                    <label htmlFor="locationInput" className="form-label">
                      {portalT.locationLabel} <span className="req">*</span>
                    </label>
                    <input
                      id="locationInput"
                      type="text"
                      placeholder={portalT.locationPlaceholder}
                      className={`form-input ${errors.location ? 'input-error' : ''}`}
                      value={location}
                      onChange={(e) => {
                        setLocation(e.target.value)
                        if (errors.location) setErrors((prev) => ({ ...prev, location: undefined }))
                      }}
                    />
                    {errors.location && <span className="form-error">{errors.location}</span>}
                  </div>

                  {/* Harvest Date */}
                  <div className="form-group full-width">
                    <label htmlFor="harvestDateInput" className="form-label">
                      {portalT.harvestDateLabel} <span className="req">*</span>
                    </label>
                    <input
                      id="harvestDateInput"
                      type="date"
                      className={`form-input ${errors.harvestDate ? 'input-error' : ''}`}
                      value={harvestDate}
                      onChange={(e) => {
                        setHarvestDate(e.target.value)
                        if (errors.harvestDate) setErrors((prev) => ({ ...prev, harvestDate: undefined }))
                      }}
                    />
                    {errors.harvestDate && <span className="form-error">{errors.harvestDate}</span>}
                  </div>

                  {/* Photo Upload with Live Preview */}
                  <div className="form-group full-width">
                    <label className="form-label">{portalT.photoLabel}</label>
                    
                    {!photo ? (
                      <div
                        className="photo-upload-zone"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.6">
                          <rect x="3" y="3" width="18" height="18" rx="4" />
                          <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                          <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="upload-prompt">{portalT.photoHint}</span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={handlePhotoChange}
                        />
                      </div>
                    ) : (
                      <div className="photo-preview-card">
                        <img src={photo} alt="Produce preview" className="photo-preview-img" />
                        <div className="photo-preview-info">
                          <span className="photo-filename">{photoName || 'produce-photo.jpg'}</span>
                          <div className="photo-actions">
                            <button
                              type="button"
                              className="btn-text-action"
                              onClick={() => fileInputRef.current?.click()}
                            >
                              {portalT.photoChange}
                            </button>
                            <button
                              type="button"
                              className="btn-text-action btn-danger-action"
                              onClick={handleRemovePhoto}
                            >
                              {portalT.photoRemove}
                            </button>
                          </div>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={handlePhotoChange}
                          />
                        </div>
                      </div>
                    )}

                    {photo && (
                      <div className="ai-quality-inspection-box">
                        {/* Idle state - show button to analyze */}
                        {qualityStatus === 'idle' && (
                          <div className="ai-quality-cta">
                            <button
                              type="button"
                              className="btn-analyze-quality"
                              onClick={handleAnalyzeQuality}
                              disabled={isAnalyzingQuality || !crop}
                            >
                              <span className="ai-sparkle">✨</span>
                              {qT.btnAnalyze || 'Analyze Quality with AI'}
                            </button>
                            {!crop ? (
                              <p className="ai-crop-hint">
                                {lang === 'hi'
                                  ? 'गुणवत्ता जांच के लिए कृपया पहले फसल चुनें।'
                                  : 'Please select a crop above before analyzing.'}
                              </p>
                            ) : (
                              <p className="ai-crop-hint">
                                {lang === 'hi'
                                  ? 'कंप्यूटर विज़न द्वारा तुरंत गुणवत्ता स्कोर और ग्रेड प्राप्त करें'
                                  : 'Get an instant quality score and grade via computer vision'}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Analyzing state */}
                        {isAnalyzingQuality && (
                          <div className="ai-analyzing-card">
                            <div className="ai-spinner"></div>
                            <div>
                              <h4>{qT.analyzingText || 'AI is inspecting produce characteristics...'}</h4>
                              <p className="ai-subtext">{qT.modelAttribution || 'Assessed by Groq AI Vision'}</p>
                            </div>
                          </div>
                        )}

                        {/* Assessed result card */}
                        {qualityStatus === 'assessed' && qualityResult && (
                          <div className="quality-result-card">
                            <div className="quality-result-header">
                              <div className="quality-score-badge-wrap">
                                <div className="quality-score-main">
                                  <span className="quality-score-label">{qT.qualityScore || 'Quality Score'}</span>
                                  <div className="quality-score-val-row">
                                    <span className="quality-score-num">{qualityResult.score}</span>
                                    <span className="quality-score-denom">/100</span>
                                  </div>
                                </div>
                                <div
                                  className="quality-grade-badge"
                                  style={{
                                    backgroundColor: getGradeBadgeStyle(qualityResult.grade).bg,
                                    color: getGradeBadgeStyle(qualityResult.grade).color,
                                    border: `1.5px solid ${getGradeBadgeStyle(qualityResult.grade).border}`,
                                  }}
                                >
                                  <span className="grade-prefix">{qT.grade || 'Grade'}</span>
                                  <span className="grade-letter">{qualityResult.grade}</span>
                                </div>
                              </div>
                              <div className="quality-confidence-tag">
                                {qT.confidence || 'Confidence'}: {Math.round(qualityResult.confidence * 100)}%
                              </div>
                            </div>

                            {qualityResult.observations && qualityResult.observations.length > 0 && (
                              <div className="quality-observations-block">
                                <span className="obs-title">{qT.observations || 'AI Observations'}:</span>
                                <ul className="obs-list">
                                  {qualityResult.observations.map((obs, idx) => (
                                    <li key={idx} className="obs-item">
                                      <span className="obs-bullet">✓</span>
                                      <span>{obs}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <div className="quality-card-footer">
                              <span className="quality-model-tag">
                                {qT.modelAttribution || 'Assessed by Groq AI Vision'}
                              </span>
                              <button
                                type="button"
                                className="btn-reanalyze"
                                onClick={handleAnalyzeQuality}
                                disabled={isAnalyzingQuality}
                              >
                                ↻ {lang === 'hi' ? 'पुनः जांचें' : 'Re-analyze'}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Unsuitable photo card */}
                        {qualityStatus === 'unsuitable' && (
                          <div className="quality-unsuitable-card">
                            <span className="unsuitable-icon">⚠️</span>
                            <div className="unsuitable-content">
                              <h4>{qT.unsuitableHeading || 'Unable to assess reliably'}</h4>
                              <p>
                                {unsuitableInfo?.reason ||
                                  qT.unsuitableDesc ||
                                  'The uploaded image does not appear to match the selected crop or is too blurry.'}
                              </p>
                              {unsuitableInfo?.observations && unsuitableInfo.observations.length > 0 && (
                                <ul className="unsuitable-obs-list">
                                  {unsuitableInfo.observations.map((obs, idx) => (
                                    <li key={idx}>{obs}</li>
                                  ))}
                                </ul>
                              )}
                              <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className="btn-text-action"
                                  onClick={() => fileInputRef.current?.click()}
                                >
                                  📷 {qT.uploadAnother || 'Upload another photo'}
                                </button>
                                <button
                                  type="button"
                                  className="btn-text-action"
                                  onClick={() => setQualityStatus('idle')}
                                >
                                  {qT.btnSubmitWithoutAi || 'Publish without AI assessment'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Error card */}
                        {qualityStatus === 'error' && (
                          <div className="quality-error-card">
                            <span className="error-icon">⚠️</span>
                            <div className="error-content">
                              <h4>{qT.errorHeading || 'Quality Assessment Notice'}</h4>
                              <p>{qualityError}</p>
                              <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className="btn-text-action"
                                  onClick={handleAnalyzeQuality}
                                  disabled={isAnalyzingQuality}
                                >
                                  ↻ {lang === 'hi' ? 'पुनः प्रयास करें' : 'Retry AI Check'}
                                </button>
                                <button
                                  type="button"
                                  className="btn-text-action"
                                  onClick={() => setQualityStatus('idle')}
                                >
                                  {qT.btnSubmitWithoutAi || 'Publish without AI assessment'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="form-submit-row">
                  <button
                    type="submit"
                    className="btn btn-primary btn-submit-listing"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? portalT.submittingButton : portalT.submitButton}
                  </button>
                </div>
              </form>
            </div>
          </section>

          {/* My Listings Section */}
          <section className="farmer-listings-section">
            <div className="listings-header">
              <div>
                <h2>{portalT.myListingsHeading}</h2>
                <p className="listings-subheading-text">{portalT.myListingsSubheading}</p>
              </div>
              <span className="listings-count-badge">
                {myListings.length} {portalT.listingCount}
              </span>
            </div>

            {myListings.length === 0 ? (
              /* Empty State */
              <div className="empty-state-card">
                <div className="empty-state-icon">
                  <IconSprout width="42" height="42" />
                </div>
                <h3>{portalT.emptyTitle}</h3>
                <p>{portalT.emptySubtitle}</p>
              </div>
            ) : (
              /* Listings Grid */
              <div className="listings-grid">
                {myListings.map((item) => {
                  const cropDisplayName = portalT.crops[item.crop] || item.crop
                  const totalEst = (item.quantity * item.price).toLocaleString('en-IN')

                  return (
                    <div className="listing-card" key={item.id}>
                      {item.photo ? (
                        <div className="listing-img-container">
                          <img
                            src={item.photo}
                            alt={cropDisplayName}
                            className="listing-card-img"
                          />
                          <span className="status-badge status-listed">
                            ● {portalT.statusListed}
                          </span>
                        </div>
                      ) : (
                        <div className="listing-no-img">
                          <div className="crop-avatar">
                            <IconSprout width="24" height="24" />
                          </div>
                          <span className="status-badge status-listed">
                            ● {portalT.statusListed}
                          </span>
                        </div>
                      )}

                      <div className="listing-card-body">
                        <div className="listing-card-title-row">
                          <div>
                            <h3 className="listing-crop-title">{cropDisplayName}</h3>
                            {item.quality?.grade && (
                              <span
                                className="produce-quality-tag"
                                style={{
                                  backgroundColor: getGradeBadgeStyle(item.quality.grade).bg,
                                  color: getGradeBadgeStyle(item.quality.grade).color,
                                  border: `1px solid ${getGradeBadgeStyle(item.quality.grade).border}`,
                                }}
                              >
                                ● {qT[`grade${item.quality.grade}`] || `Grade ${item.quality.grade}`} ({item.quality.score}/100)
                              </span>
                            )}
                            {item.fairPrice?.suggestedPrice && (
                              <div className="fair-price-card-badge">
                                <span>⚖️</span>
                                <span>{fpT.fairRate || 'Fair Price'}: ₹{item.fairPrice.suggestedPrice}/kg</span>
                              </div>
                            )}
                            {item.pickupDecision && item.pickupDecision.method && (
                              <div className={`pickup-listing-badge ${item.pickupDecision.method === 'HUB' ? 'hub' : 'home'}`}>
                                <span>{item.pickupDecision.method === 'HUB' ? '🚚' : '🚜'}</span>
                                <span>
                                  {item.pickupDecision.method === 'HUB'
                                    ? (pkT.hubBadge || 'Hub Pickup')
                                    : (pkT.homeBadge || 'Farm Pickup')}
                                </span>
                              </div>
                            )}
                            {isEligibleForHubListing(item) && (
                              <div className="hub-aggregated-badge">
                                <span>🚚</span>
                                <span>{aggT.includedInHub || 'Included in Hub Aggregation'}</span>
                              </div>
                            )}
                            {item.traceabilityId && (
                              <div className="traceability-card-chip" title="Verified Traceability ID">
                                <span>🏷️</span>
                                <code>{item.traceabilityId}</code>
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            className="btn-delete-listing"
                            onClick={() => handleDeleteListing(item.id)}
                            title={portalT.deleteListing}
                            aria-label={portalT.deleteListing}
                          >
                            ×
                          </button>
                        </div>

                        <div className="listing-metrics-grid">
                          <div className="metric-box">
                            <span className="metric-label">{portalT.quantityLabel}</span>
                            <span className="metric-value">{item.quantity} kg</span>
                          </div>
                          <div className="metric-box">
                            <span className="metric-label">{portalT.priceLabel}</span>
                            <span className="metric-value">₹{item.price} {portalT.perKg}</span>
                          </div>
                        </div>

                        <div className="metric-est-total">
                          <span>{portalT.totalEstimatedValue}:</span>
                          <strong>₹{totalEst}</strong>
                        </div>

                        <div className="listing-footer-meta">
                          <div className="meta-line">
                            <IconPin width="14" height="14" />
                            <span>{item.location}</span>
                          </div>
                          <div className="meta-line">
                            <IconTag width="14" height="14" />
                            <span>{portalT.harvestDate}: {item.harvestDate}</span>
                          </div>
                        </div>

                        {/* Buyer Matches & Traceability CTAs on listing card */}
                        <div className="listing-cta-row">
                          {(() => {
                            const lotMatches = findBuyerMatches({
                              listing: item,
                              currentUserId: session?.id,
                              lang,
                            })
                            return (
                              <button
                                type="button"
                                className="btn-listing-matches"
                                onClick={() => setActiveMatchesListing(item)}
                              >
                                <span>🤝</span>
                                <span>{bmT.viewMatchesAction || 'Buyer Matches'}</span>
                                <span className="matches-count-pill">{lotMatches.length}</span>
                              </button>
                            )
                          })()}

                          <div className="listing-tr-actions">
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
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* ======================================================== */}
          {/* INCOMING BUYER ORDERS & ESCROW ACTIVITY SECTION */}
          {/* ======================================================== */}
          <section className="farmer-orders-section">
            <div className="section-header-row">
              <div>
                <h2 className="section-title">🔒 {escrowT.farmerOrdersTitle || 'Incoming Buyer Orders & Escrow'}</h2>
                <p className="section-subheading">{escrowT.farmerOrdersSubtitle || 'Orders placed by buyers with funds locked in secure demo escrow.'}</p>
              </div>
              <span className="orders-count-badge">
                {farmerOrders.length} {t.dashboard?.ordersPlaced || 'orders'}
              </span>
            </div>

            {farmerOrders.length === 0 ? (
              <div className="empty-state-card">
                <div className="empty-state-icon">📦</div>
                <h3>{escrowT.noIncomingOrdersTitle || 'No Buyer Orders Yet'}</h3>
                <p>{escrowT.noIncomingOrdersSubtitle || 'When buyers purchase your listed produce, their secured escrow orders and fulfillment steps will appear here.'}</p>
              </div>
            ) : (
              <div className="orders-list">
                {farmerOrders.map((order) => {
                  const cropName = portalT.crops[order.crop] || order.crop
                  const orderDate = new Date(order.createdAt).toLocaleDateString()

                  return (
                    <div className="order-card farmer-escrow-card" key={order.orderId || order.id}>
                      <div className="order-card-top">
                        <div className="order-id-block">
                          <span className="order-label">{t.buyerMarketplace?.orderId || 'Order'}:</span>
                          <span className="order-id-val">#{order.orderId || order.id}</span>
                        </div>
                        <span className={`order-status-badge ${order.fulfillmentStatus === 'PAYMENT_RELEASED' ? 'status-released' : 'status-secured'}`}>
                          {order.fulfillmentStatus === 'PAYMENT_RELEASED'
                            ? `✅ ${escrowT.farmerReleased || 'Payment Released'}`
                            : order.fulfillmentStatus === 'DELIVERED'
                            ? `📦 ${escrowT.farmerDelivered || 'Delivered'}`
                            : order.fulfillmentStatus === 'IN_TRANSIT'
                            ? `🚚 ${escrowT.farmerInTransit || 'In Transit'}`
                            : order.fulfillmentStatus === 'PICKUP_SCHEDULED'
                            ? `📅 ${escrowT.farmerPickup || 'Pickup Scheduled'}`
                            : order.fulfillmentStatus === 'VERIFICATION_PENDING'
                            ? `⚖️ ${escrowT.farmerVerification || 'Quality & Weight Verification'}`
                            : `🔒 ${escrowT.farmerPaymentSecured || 'Buyer Payment Secured'}`}
                        </span>
                      </div>

                      <div className="order-card-body">
                        {/* Secured Escrow Callout for Farmer */}
                        <div className={`escrow-status-callout ${order.payment?.status === 'RELEASED' ? 'released' : 'secured'}`}>
                          <div className="escrow-callout-left">
                            <span className="escrow-lock-icon">{order.payment?.status === 'RELEASED' ? '💰' : '🔒'}</span>
                            <div>
                              <span className="escrow-callout-amount">₹{(order.totalAmount || 0).toLocaleString('en-IN')} secured</span>
                              <span className="escrow-callout-label">
                                {order.payment?.status === 'RELEASED'
                                  ? (escrowT.releasedBadge || 'Payment Released to You')
                                  : (escrowT.farmerPaymentSecured || 'Buyer Payment Secured')}
                              </span>
                            </div>
                          </div>
                          <span className="escrow-demo-pill">{escrowT.simulatedEscrow || 'Simulated Escrow'}</span>
                        </div>

                        {/* Crop & Buyer Info */}
                        <div className="order-crop-info">
                          <div className="order-avatar">
                            <IconSprout width="22" height="22" />
                          </div>
                          <div>
                            <h4 className="order-crop-title">{cropName}</h4>
                            <span className="order-date-text">
                              Buyer: <strong>{order.buyerName || 'Verified Buyer'}</strong> {order.buyerLocation ? `(${order.buyerLocation})` : ''} • Placed {orderDate}
                            </span>
                          </div>
                        </div>

                        {/* Metrics Grid */}
                        <div className="order-metrics-grid">
                          <div className="order-metric">
                            <span className="om-label">{portalT.quantityLabel || 'Quantity'}</span>
                            <span className="om-val">{order.quantityKg || order.quantity} kg</span>
                          </div>
                          <div className="order-metric">
                            <span className="om-label">{portalT.priceLabel || 'Rate'}</span>
                            <span className="om-val">₹{order.ratePerKg || order.pricePerKg} {portalT.perKg}</span>
                          </div>
                          <div className="order-metric highlight">
                            <span className="om-label">{escrowT.total || 'Total Value'}</span>
                            <span className="om-val total">₹{(order.totalAmount || 0).toLocaleString('en-IN')}</span>
                          </div>
                        </div>

                        {/* Visual 6-step Progress Timeline */}
                        <EscrowTimeline fulfillmentStatus={order.fulfillmentStatus} t={escrowT} />

                        {/* Order Traceability Actions */}
                        <div className="order-tr-row">
                          <span className="order-tr-id-badge">
                            🏷️ <code>{order.traceabilityId || 'TRC-2026-PENDING'}</code>
                          </span>
                          <div className="order-tr-btns">
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

                        {/* Allocation Actions for Multi-Farmer Engine */}
                        {order.allocationId && (
                          <div className="allocation-action-row" style={{ margin: '12px 0', padding: '10px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <div>
                              <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>
                                {lang === 'hi' ? 'आवंटन स्थिति:' : 'Allocation Status:'}{' '}
                              </span>
                              <span style={{
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '0.8rem',
                                fontWeight: 'bold',
                                background: order.allocationStatus === 'ACCEPTED' ? '#dcfce7' : order.allocationStatus === 'REJECTED' ? '#fee2e2' : '#fef9c3',
                                color: order.allocationStatus === 'ACCEPTED' ? '#15803d' : order.allocationStatus === 'REJECTED' ? '#b91c1c' : '#854d0e',
                              }}>
                                ● {order.allocationStatus || 'PENDING'}
                              </span>
                            </div>
                            {order.allocationStatus === 'PENDING' && (
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  style={{ background: '#16a34a', borderColor: '#16a34a' }}
                                  onClick={() => handleAcceptAllocation(order.allocationId)}
                                >
                                  ✓ {lang === 'hi' ? 'स्वीकार करें' : 'Accept Allocation'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  style={{ color: '#dc2626', borderColor: '#dc2626' }}
                                  onClick={() => handleRejectAllocation(order.allocationId)}
                                >
                                  ✕ {lang === 'hi' ? 'अस्वीकार करें' : 'Reject'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Action Controls for Demo Progression */}
                        <div className="order-escrow-actions">
                          {order.fulfillmentStatus !== 'PAYMENT_RELEASED' ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary btn-advance-order"
                              onClick={() => handleAdvanceFarmerOrder(order.orderId || order.id)}
                            >
                              <span>⚡ {escrowT.advanceFulfillment || 'Advance Fulfillment (Demo)'} →</span>
                            </button>
                          ) : (
                            <span className="order-completed-tag">
                              💰 {escrowT.orderCompleted || 'Order Completed — Funds Released'}
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
          </section>
        </div>
      </div>

      {/* ======================================================== */}
      {/* MODAL 1: BUYER MATCHES MODAL FOR SPECIFIC LISTING */}
      {/* ======================================================== */}
      {activeMatchesListing && (() => {
        const matches = findBuyerMatches({
          listing: activeMatchesListing,
          currentUserId: session?.id,
          lang,
        })
        const cropName = portalT.crops[activeMatchesListing.crop] || activeMatchesListing.crop

        return (
          <div className="modal-backdrop" onClick={() => setActiveMatchesListing(null)}>
            <div
              className="modal-card modal-produce-detail"
              role="dialog"
              style={{ maxWidth: '640px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-detail-header">
                <h3>
                  🤝 {bmT.sectionTitle || 'Best Buyer Matches'} — {cropName} ({activeMatchesListing.quantity} kg)
                </h3>
                <button
                  type="button"
                  className="modal-close-icon"
                  onClick={() => setActiveMatchesListing(null)}
                >
                  ×
                </button>
              </div>

              <div className="modal-detail-content" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                <p style={{ margin: '0 0 16px', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                  {bmT.sectionSubtitle ||
                    'AI ranked potential buyers based on crop demand, volume, price, proximity, and quality.'}
                </p>

                {matches.length === 0 ? (
                  <div className="empty-matches-notice">
                    <div className="empty-matches-icon">🔍</div>
                    <h4>{bmT.noMatchesTitle || 'No Buyer Demand Found Yet'}</h4>
                    <p>
                      {bmT.noMatchesSubtitle ||
                        'When buyers place orders or express demand for this crop on the marketplace, top matching buyers will automatically appear here.'}
                    </p>
                  </div>
                ) : (
                  <div className="buyer-matches-grid">
                    {matches.map((match) => {
                      const isSent = !!sentOffers[match.id]
                      const scoreClass =
                        match.matchScore >= 85
                          ? 'score-green'
                          : match.matchScore >= 70
                          ? 'score-amber'
                          : 'score-blue'

                      return (
                        <div
                          key={match.id}
                          className={`buyer-match-card ${
                            match.matchScore >= 85 ? 'high-match' : match.matchScore >= 70 ? 'medium-match' : ''
                          }`}
                        >
                          <div className="match-card-top">
                            <div className="match-buyer-info">
                              <h4>{match.buyerName}</h4>
                              <span className="match-buyer-loc">📍 {match.buyerLocation}</span>
                            </div>
                            <span className={`match-score-badge ${scoreClass}`}>
                              ● {match.matchScore}% {bmT.matchScore || 'Match'}
                            </span>
                          </div>

                          <div className="match-metrics-grid">
                            <div className="match-metric-item">
                              <span className="m-metric-label">{bmT.requiredQty || 'Required Qty'}</span>
                              <span className="m-metric-val">{match.quantity} kg</span>
                            </div>
                            <div className="match-metric-item">
                              <span className="m-metric-label">{bmT.offeredPrice || 'Offered Price'}</span>
                              <span className="m-metric-val">₹{match.offeredPrice}/kg</span>
                            </div>
                          </div>

                          <span className="match-distance-tag">
                            🚚 {match.distanceEstimate}
                          </span>

                          <ul className="match-reasons-list">
                            {match.reasons.map((reason, idx) => (
                              <li key={idx}>
                                <span className="reason-check">✓</span>
                                <span>{reason}</span>
                              </li>
                            ))}
                          </ul>

                          <div className="match-card-actions">
                            <button
                              type="button"
                              className={`btn-send-offer ${isSent ? 'sent' : ''}`}
                              onClick={() => !isSent && handleSendOffer(match, activeMatchesListing)}
                              disabled={isSent}
                            >
                              {isSent ? `✓ ${bmT.offerSent || 'Offer Sent'}` : `📤 ${bmT.btnSendOffer || 'Send Offer'}`}
                            </button>
                            <button
                              type="button"
                              className="btn-view-buyer-details"
                              onClick={() => setInspectingBuyerMatch({ match, listing: activeMatchesListing })}
                              title={bmT.btnViewBuyer || 'Buyer Details'}
                            >
                              ℹ️
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setActiveMatchesListing(null)}
                >
                  {bmT.closeBtn || 'Close'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ======================================================== */}
      {/* MODAL 2: BUYER DETAIL INSPECTION MODAL */}
      {/* ======================================================== */}
      {inspectingBuyerMatch && (() => {
        const { match, listing } = inspectingBuyerMatch
        const isSent = !!sentOffers[match.id]
        const asking = listing?.price ?? listing?.expectedPrice ?? 0

        return (
          <div className="modal-backdrop" onClick={() => setInspectingBuyerMatch(null)}>
            <div
              className="modal-card"
              role="dialog"
              style={{ maxWidth: '520px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-detail-header">
                <h3>{bmT.modalTitle || 'Buyer Demand Details'}</h3>
                <button
                  type="button"
                  className="modal-close-icon"
                  onClick={() => setInspectingBuyerMatch(null)}
                >
                  ×
                </button>
              </div>

              <div className="modal-detail-content">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div>
                    <h2 style={{ margin: '0 0 2px', fontSize: '1.25rem', color: 'var(--green-deep)' }}>{match.buyerName}</h2>
                    <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>📍 {match.buyerLocation}</span>
                  </div>
                  <span className="match-score-badge score-green" style={{ fontSize: '0.95rem' }}>
                    ● {match.matchScore}% {bmT.matchScore || 'Match'}
                  </span>
                </div>

                <div className="detail-facts-grid" style={{ marginBottom: '16px' }}>
                  <div className="fact-item">
                    <span className="fact-label">{bmT.demandCrop || 'Crop Demanded'}</span>
                    <span className="fact-val">{portalT.crops[match.crop] || match.crop}</span>
                  </div>
                  <div className="fact-item">
                    <span className="fact-label">{bmT.demandQuantity || 'Demand Volume'}</span>
                    <span className="fact-val">{match.quantity} kg</span>
                  </div>
                  <div className="fact-item">
                    <span className="fact-label">{bmT.offeredRate || 'Offered Rate'}</span>
                    <span className="fact-val">₹{match.offeredPrice}/kg</span>
                  </div>
                  <div className="fact-item">
                    <span className="fact-label">{bmT.askingRate || 'Your Asking Rate'}</span>
                    <span className="fact-val">₹{asking}/kg</span>
                  </div>
                </div>

                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid #e2e8f0', marginBottom: '14px' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>
                    {bmT.contactBuyer || 'Buyer Contact'} (Demo / Privacy Protected)
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-dark)' }}>
                    📞 {match.buyerMobile}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    🚚 {match.distanceEstimate}
                  </div>
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#166534', marginBottom: '6px' }}>
                    {bmT.reasonsTitle || 'Match Factors'}:
                  </div>
                  <ul className="match-reasons-list">
                    {match.reasons.map((reason, idx) => (
                      <li key={idx} style={{ fontSize: '0.82rem' }}>
                        <span className="reason-check">✓</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setInspectingBuyerMatch(null)}
                >
                  {bmT.closeBtn || 'Close'}
                </button>
                <button
                  type="button"
                  className={`btn btn-primary ${isSent ? 'btn-success' : ''}`}
                  onClick={() => {
                    handleSendOffer(match, listing)
                    setInspectingBuyerMatch(null)
                  }}
                  disabled={isSent}
                >
                  {isSent ? `✓ ${bmT.offerSent || 'Offer Sent'}` : `📤 ${bmT.btnSendOffer || 'Send Offer'}`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

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

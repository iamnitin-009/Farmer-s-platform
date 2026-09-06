import { useState } from 'react'
import { useLanguage } from '../context/LanguageContext.jsx'
import { registerUser, loginUser } from '../utils/auth.js'
import PragatiLogo, { PragatiSymbol } from '../components/PragatiLogo.jsx'

export default function AuthPage({ onNavigate, onAuthSuccess, initialMode = 'login' }) {
  const { t } = useLanguage()
  const authT = t.unifiedAuth

  const [mode, setMode] = useState(initialMode) // 'login' or 'register'

  // Form input states
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [location, setLocation] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Validation & feedback states
  const [errors, setErrors] = useState({})
  const [generalError, setGeneralError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Validate Indian mobile number format (10 digits starting with 6, 7, 8, 9)
  const isValidIndianMobile = (num) => {
    const cleaned = num.replace(/\s+/g, '').replace(/^(\+91|0)/, '')
    return /^[6-9]\d{9}$/.test(cleaned)
  }

  const cleanMobileNumber = (num) => {
    return num.replace(/\s+/g, '').replace(/^(\+91|0)/, '')
  }

  // Switch between login and register tabs
  const handleSwitchMode = (newMode) => {
    setMode(newMode)
    setErrors({})
    setGeneralError('')
  }

  // Validate Login Form
  const validateLogin = () => {
    const newErrors = {}
    const trimmed = mobile.trim()
    const cleanedMobile = cleanMobileNumber(mobile)

    if (!trimmed) {
      newErrors.mobile = authT.validation.mobileRequired
    } else if (trimmed.toLowerCase() !== 'admin' && !isValidIndianMobile(cleanedMobile)) {
      newErrors.mobile = authT.validation.mobileInvalid
    }

    if (!password) {
      newErrors.password = authT.validation.passwordRequired
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Validate Register Form (No role selection!)
  const validateRegister = () => {
    const newErrors = {}
    const cleanedMobile = cleanMobileNumber(mobile)

    if (!name.trim()) {
      newErrors.name = authT.validation.nameRequired
    }

    if (!mobile.trim()) {
      newErrors.mobile = authT.validation.mobileRequired
    } else if (!isValidIndianMobile(cleanedMobile)) {
      newErrors.mobile = authT.validation.mobileInvalid
    }

    if (!location.trim()) {
      newErrors.location = authT.validation.locationRequired
    }

    if (!password) {
      newErrors.password = authT.validation.passwordRequired
    } else if (password.length < 6) {
      newErrors.password = authT.validation.passwordLength
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = authT.validation.confirmPasswordRequired
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = authT.validation.passwordsDoNotMatch
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Handle Login submission
  const handleLoginSubmit = async (e) => {
    e.preventDefault()
    setGeneralError('')

    if (!validateLogin()) return

    setIsSubmitting(true)
    try {
      const trimmed = mobile.trim()
      const loginIdentifier = trimmed.toLowerCase() === 'admin' ? 'admin' : cleanMobileNumber(mobile)
      const res = await loginUser({
        mobile: loginIdentifier,
        password,
      })

      if (res.success) {
        onAuthSuccess(res.user)
      } else {
        if (res.error === 'account_suspended') {
          setGeneralError('This account has been suspended by the platform administrator.')
        } else if (res.error === 'invalid_credentials') {
          setGeneralError(authT.validation.invalidCredentials)
        } else {
          setGeneralError(authT.validation.invalidCredentials)
        }
      }
    } catch (err) {
      console.error('Login error:', err)
      setGeneralError('An unexpected error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle Register submission
  const handleRegisterSubmit = async (e) => {
    e.preventDefault()
    setGeneralError('')

    if (!validateRegister()) return

    setIsSubmitting(true)
    try {
      const res = await registerUser({
        name: name.trim(),
        mobile: cleanMobileNumber(mobile),
        location: location.trim(),
        password,
      })

      if (res.success) {
        onAuthSuccess(res.user)
      } else {
        if (res.error === 'duplicate_mobile') {
          setGeneralError(authT.validation.duplicateMobile)
        } else {
          setGeneralError('Registration failed. Please try again.')
        }
      }
    } catch (err) {
      console.error('Register error:', err)
      setGeneralError('An unexpected error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      {/* Top bar with back to home */}
      <div className="auth-top-bar">
        <div className="section-inner auth-nav-inner">
          <button
            className="btn-back-home"
            type="button"
            onClick={() => onNavigate('/')}
          >
            ← {t.farmerPortal.backToHome}
          </button>
        </div>
      </div>

      <div className="section-inner auth-container">
        {/* Prominent PRAGATI Brand Logo & Wordmark above Auth Form */}
        <div
          className="auth-brand-banner"
          onClick={() => onNavigate('/')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onNavigate('/')}
          style={{ cursor: 'pointer', textAlign: 'center', marginBottom: '22px' }}
          title={t.farmerPortal?.backToHome || 'Home'}
        >
          <PragatiLogo size="lg" variant="dark" showTagline={true} taglineText={t.header?.tagline} />
        </div>

        <div className="auth-card">
          {/* Card Header with Icon and Title */}
          <div className="auth-header">
            <div className="auth-icon-wrap pragati-auth-icon-wrap">
              <PragatiSymbol size={40} />
            </div>
            <h1>{mode === 'login' ? authT.loginHeading : authT.registerHeading}</h1>
            <p className="auth-subheading">
              {mode === 'login' ? authT.loginSubheading : authT.registerSubheading}
            </p>
          </div>

          {/* Tab Switcher */}
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={`auth-tab ${mode === 'login' ? 'is-active' : ''}`}
              onClick={() => handleSwitchMode('login')}
            >
              {authT.loginTab}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              className={`auth-tab ${mode === 'register' ? 'is-active' : ''}`}
              onClick={() => handleSwitchMode('register')}
            >
              {authT.registerTab}
            </button>
          </div>

          {/* Alert for general error (e.g. invalid credentials or duplicate mobile) */}
          {generalError && (
            <div className="auth-alert-error" role="alert">
              <span className="alert-icon">!</span>
              <span>{generalError}</span>
            </div>
          )}

          {/* ======================================================== */}
          {/* LOGIN FORM */}
          {/* ======================================================== */}
          {mode === 'login' && (
            <form onSubmit={handleLoginSubmit} className="auth-form" noValidate>
              <div className="form-group">
                <label htmlFor="loginMobile" className="form-label">
                  {authT.mobileLabel} <span className="req">*</span>
                </label>
                <input
                  id="loginMobile"
                  type="tel"
                  placeholder={authT.mobilePlaceholder}
                  className={`form-input ${errors.mobile ? 'input-error' : ''}`}
                  value={mobile}
                  onChange={(e) => {
                    setMobile(e.target.value)
                    if (errors.mobile) setErrors((prev) => ({ ...prev, mobile: '' }))
                  }}
                  autoComplete="tel"
                />
                {errors.mobile && <span className="form-error">{errors.mobile}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="loginPassword" className="form-label">
                  {authT.passwordLabel} <span className="req">*</span>
                </label>
                <input
                  id="loginPassword"
                  type="password"
                  placeholder={authT.passwordPlaceholder}
                  className={`form-input ${errors.password ? 'input-error' : ''}`}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (errors.password) setErrors((prev) => ({ ...prev, password: '' }))
                  }}
                  autoComplete="current-password"
                />
                {errors.password && <span className="form-error">{errors.password}</span>}
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-submit-auth"
                disabled={isSubmitting}
              >
                {isSubmitting ? authT.loggingIn : authT.loginButton}
              </button>

              <div className="auth-switch-prompt">
                <span>{authT.noAccountPrompt}</span>{' '}
                <button
                  type="button"
                  className="btn-switch-link"
                  onClick={() => handleSwitchMode('register')}
                >
                  {authT.switchToRegister}
                </button>
              </div>
            </form>
          )}

          {/* ======================================================== */}
          {/* REGISTER FORM */}
          {/* ======================================================== */}
          {mode === 'register' && (
            <form onSubmit={handleRegisterSubmit} className="auth-form" noValidate>
              <div className="form-group">
                <label htmlFor="regName" className="form-label">
                  {authT.nameLabel} <span className="req">*</span>
                </label>
                <input
                  id="regName"
                  type="text"
                  placeholder={authT.namePlaceholder}
                  className={`form-input ${errors.name ? 'input-error' : ''}`}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (errors.name) setErrors((prev) => ({ ...prev, name: '' }))
                  }}
                  autoComplete="name"
                />
                {errors.name && <span className="form-error">{errors.name}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="regMobile" className="form-label">
                  {authT.mobileLabel} <span className="req">*</span>
                </label>
                <input
                  id="regMobile"
                  type="tel"
                  placeholder={authT.mobilePlaceholder}
                  className={`form-input ${errors.mobile ? 'input-error' : ''}`}
                  value={mobile}
                  onChange={(e) => {
                    setMobile(e.target.value)
                    if (errors.mobile) setErrors((prev) => ({ ...prev, mobile: '' }))
                  }}
                  autoComplete="tel"
                />
                {errors.mobile && <span className="form-error">{errors.mobile}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="regLocation" className="form-label">
                  {authT.locationLabel} <span className="req">*</span>
                </label>
                <input
                  id="regLocation"
                  type="text"
                  placeholder={authT.locationPlaceholder}
                  className={`form-input ${errors.location ? 'input-error' : ''}`}
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value)
                    if (errors.location) setErrors((prev) => ({ ...prev, location: '' }))
                  }}
                  autoComplete="address-level2"
                />
                {errors.location && <span className="form-error">{errors.location}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="regPassword" className="form-label">
                  {authT.passwordLabel} <span className="req">*</span>
                </label>
                <input
                  id="regPassword"
                  type="password"
                  placeholder={authT.passwordPlaceholder}
                  className={`form-input ${errors.password ? 'input-error' : ''}`}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (errors.password) setErrors((prev) => ({ ...prev, password: '' }))
                  }}
                  autoComplete="new-password"
                />
                {errors.password && <span className="form-error">{errors.password}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="regConfirmPassword" className="form-label">
                  {authT.confirmPasswordLabel} <span className="req">*</span>
                </label>
                <input
                  id="regConfirmPassword"
                  type="password"
                  placeholder={authT.confirmPasswordPlaceholder}
                  className={`form-input ${errors.confirmPassword ? 'input-error' : ''}`}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    if (errors.confirmPassword)
                      setErrors((prev) => ({ ...prev, confirmPassword: '' }))
                  }}
                  autoComplete="new-password"
                />
                {errors.confirmPassword && (
                  <span className="form-error">{errors.confirmPassword}</span>
                )}
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-submit-auth"
                disabled={isSubmitting}
              >
                {isSubmitting ? authT.registering : authT.registerButton}
              </button>

              <div className="auth-switch-prompt">
                <span>{authT.hasAccountPrompt}</span>{' '}
                <button
                  type="button"
                  className="btn-switch-link"
                  onClick={() => handleSwitchMode('login')}
                >
                  {authT.switchToLogin}
                </button>
              </div>
            </form>
          )}

          {/* Prototype disclaimer footer */}
          <div className="auth-demo-notice">
            <span className="notice-icon">ℹ</span>
            <span>{authT.demoNotice}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

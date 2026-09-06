import { useState } from 'react'
import { useLanguage } from '../context/LanguageContext.jsx'
import { IconMic } from './Icons.jsx'
import { PragatiSymbol } from './PragatiLogo.jsx'

// props:
// - onVoiceClick: function called when the Voice Assistant button is pressed
// - onNavigate: optional navigation function
// - currentPath: current URL path string
// - session: current farmer session object or null
// - onLogout: function called when logging out
export default function Header({ onVoiceClick, onNavigate, currentPath, session, onLogout }) {
  const { t, lang, toggleLang } = useLanguage()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleBrandClick = () => {
    setMobileMenuOpen(false)
    if (onNavigate) {
      onNavigate('/')
    }
  }

  const handleNav = (path) => {
    setMobileMenuOpen(false)
    if (onNavigate) {
      onNavigate(path)
    }
  }

  const handleLogout = () => {
    setMobileMenuOpen(false)
    if (onLogout) {
      onLogout()
    }
  }

  const isPortalOrAuth =
    currentPath === '/farmer' ||
    currentPath === '/farmer-auth' ||
    currentPath === '/buyer' ||
    currentPath === '/dashboard' ||
    currentPath === '/hub' ||
    currentPath === '/logistics' ||
    currentPath === '/auth' ||
    currentPath === '/admin' ||
    currentPath.startsWith('/traceability')

  const role = session?.role || 'farmer'
  const isAdmin = session && role === 'admin'
  const isBuyer = session && role === 'buyer'
  const isFarmer = session && (!role || role === 'farmer')

  return (
    <header className="header">
      <div className="header-inner">
        <div
          className="brand"
          onClick={handleBrandClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleBrandClick()}
          style={{ cursor: 'pointer' }}
          title={t.farmerPortal?.backToHome || 'Home'}
        >
          <span className="brand-icon">
            <PragatiSymbol size={34} />
          </span>
          <div className="brand-text">
            <span className="brand-title">{t.header.title}</span>
            <span className="brand-tagline">{t.header.tagline}</span>
          </div>
        </div>

        <div className="header-actions">
          <nav
            className={`header-nav ${mobileMenuOpen ? 'header-nav-open' : ''}`}
            aria-label="Main Navigation"
          >
            {/* Common Home button when outside landing */}
            {isPortalOrAuth && (
              <button
                className="btn btn-outline header-btn-home"
                onClick={() => handleNav('/')}
                type="button"
                style={{
                  color: '#fff',
                  borderColor: 'rgba(255, 255, 255, 0.35)',
                  padding: '7px 12px',
                  fontSize: '0.84rem',
                }}
              >
                {t.farmerPortal?.backToHome || 'Home'}
              </button>
            )}

            {/* ADMIN-SPECIFIC NAVIGATION */}
            {isAdmin && (
              <>
                <button
                  className="btn btn-outline header-btn-dashboard header-btn-admin"
                  onClick={() => handleNav('/admin')}
                  type="button"
                  style={{
                    color: '#fff',
                    borderColor: '#4caf50',
                    backgroundColor: currentPath === '/admin' ? 'rgba(76, 175, 80, 0.25)' : 'transparent',
                    padding: '7px 12px',
                    fontSize: '0.84rem',
                    fontWeight: 'bold',
                  }}
                >
                  🛡️ Admin Console
                </button>

                <button
                  className="btn btn-outline header-btn-logistics"
                  onClick={() => handleNav('/logistics')}
                  type="button"
                  style={{
                    color: '#fff',
                    borderColor: 'rgba(255, 255, 255, 0.45)',
                    padding: '7px 12px',
                    fontSize: '0.84rem',
                  }}
                >
                  🗺️ Logistics Overview
                </button>
              </>
            )}

            {/* FARMER-SPECIFIC NAVIGATION */}
            {isFarmer && (
              <>
                {currentPath !== '/dashboard' && (
                  <button
                    className="btn btn-outline header-btn-dashboard"
                    onClick={() => handleNav('/dashboard')}
                    type="button"
                    style={{
                      color: '#fff',
                      borderColor: 'rgba(255, 255, 255, 0.45)',
                      padding: '7px 12px',
                      fontSize: '0.84rem',
                    }}
                  >
                    {t.dashboard?.backToDashboard || 'Dashboard'}
                  </button>
                )}

                {currentPath !== '/farmer' && (
                  <button
                    className="btn btn-outline header-btn-sell"
                    onClick={() => handleNav('/farmer')}
                    type="button"
                    style={{
                      color: '#fff',
                      borderColor: 'rgba(255, 255, 255, 0.45)',
                      padding: '7px 12px',
                      fontSize: '0.84rem',
                    }}
                  >
                    🌾 My Produce / Sell
                  </button>
                )}

                {currentPath !== '/hub' && (
                  <button
                    className="btn btn-outline header-btn-hub"
                    onClick={() => handleNav('/hub')}
                    type="button"
                    style={{
                      color: '#fff',
                      borderColor: 'rgba(255, 255, 255, 0.45)',
                      padding: '7px 12px',
                      fontSize: '0.84rem',
                    }}
                  >
                    🚚 {t.hubAggregation?.title || 'Hub'}
                  </button>
                )}

                {currentPath !== '/logistics' && (
                  <button
                    className="btn btn-outline header-btn-logistics"
                    onClick={() => handleNav('/logistics')}
                    type="button"
                    style={{
                      color: '#fff',
                      borderColor: 'rgba(255, 255, 255, 0.45)',
                      padding: '7px 12px',
                      fontSize: '0.84rem',
                    }}
                  >
                    🗺️ {t.routeOptimization?.navTitle || 'Logistics'}
                  </button>
                )}
              </>
            )}

            {/* BUYER-SPECIFIC NAVIGATION */}
            {isBuyer && (
              <>
                {currentPath !== '/dashboard' && (
                  <button
                    className="btn btn-outline header-btn-dashboard"
                    onClick={() => handleNav('/dashboard')}
                    type="button"
                    style={{
                      color: '#fff',
                      borderColor: 'rgba(255, 255, 255, 0.45)',
                      padding: '7px 12px',
                      fontSize: '0.84rem',
                    }}
                  >
                    {t.dashboard?.backToDashboard || 'Dashboard'}
                  </button>
                )}

                {currentPath !== '/buyer' && (
                  <button
                    className="btn btn-outline header-btn-marketplace"
                    onClick={() => handleNav('/buyer')}
                    type="button"
                    style={{
                      color: '#fff',
                      borderColor: 'rgba(255, 255, 255, 0.45)',
                      padding: '7px 12px',
                      fontSize: '0.84rem',
                    }}
                  >
                    🛒 Marketplace
                  </button>
                )}

                {currentPath !== '/logistics' && (
                  <button
                    className="btn btn-outline header-btn-logistics"
                    onClick={() => handleNav('/logistics')}
                    type="button"
                    style={{
                      color: '#fff',
                      borderColor: 'rgba(255, 255, 255, 0.45)',
                      padding: '7px 12px',
                      fontSize: '0.84rem',
                    }}
                  >
                    🗺️ {t.routeOptimization?.navTitle || 'Logistics'}
                  </button>
                )}
              </>
            )}

            {/* TRACEABILITY: Accessible to all roles */}
            {!currentPath.startsWith('/traceability') && (
              <button
                className="btn btn-outline header-btn-traceability"
                onClick={() => handleNav('/traceability')}
                type="button"
                style={{
                  color: '#fff',
                  borderColor: 'rgba(255, 255, 255, 0.45)',
                  padding: '7px 12px',
                  fontSize: '0.84rem',
                }}
              >
                🏷️ {t.traceability?.navTitle || 'Traceability'}
              </button>
            )}

            {/* UNAUTHENTICATED GUEST LOGIN BUTTON */}
            {!session && currentPath !== '/auth' && (
              <button
                className="btn btn-outline header-btn-auth"
                onClick={() => handleNav('/auth')}
                type="button"
                style={{
                  color: '#fff',
                  borderColor: 'rgba(255, 255, 255, 0.45)',
                  padding: '7px 12px',
                  fontSize: '0.84rem',
                }}
              >
                {t.header?.loginCta || 'Login / Get Started'}
              </button>
            )}

            {/* AUTHENTICATED USER / ROLE BADGE & LOGOUT */}
            {session && (
              <div className="header-farmer-badge header-user-badge">
                <span className="header-farmer-name">
                  {isAdmin ? '🛡️ Admin' : isBuyer ? `🛒 ${session.name.split(' ')[0]}` : `🧑‍🌾 ${session.name.split(' ')[0]}`}
                </span>
                <button
                  type="button"
                  className="header-btn-logout"
                  onClick={handleLogout}
                  title={t.unifiedAuth?.logout || t.auth?.logout || 'Log Out'}
                >
                  {t.unifiedAuth?.logout || t.auth?.logout || 'Log Out'}
                </button>
              </div>
            )}
          </nav>

          <button className="voice-btn" onClick={onVoiceClick} type="button">
            <IconMic />
            <span>{t.header.voiceAssistant}</span>
          </button>

          {/* Language toggle: shows the language you can SWITCH TO,
              which is a simple and common convention for toggles. */}
          <button
            className="lang-toggle"
            onClick={toggleLang}
            type="button"
            aria-label="Toggle language"
          >
            <span className={lang === 'en' ? 'lang-active' : ''}>EN</span>
            <span className="lang-divider">/</span>
            <span className={lang === 'hi' ? 'lang-active' : ''}>हिं</span>
          </button>

          {/* Mobile hamburger menu toggle button */}
          <button
            className="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            type="button"
            aria-label={mobileMenuOpen ? 'Close Menu' : 'Open Navigation Menu'}
            aria-expanded={mobileMenuOpen}
          >
            <span className="hamburger-icon">{mobileMenuOpen ? '✕' : '☰'}</span>
          </button>
        </div>
      </div>
    </header>
  )
}

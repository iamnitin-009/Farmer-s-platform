import { useLanguage } from '../context/LanguageContext.jsx'
import { IconLeaf, IconMic } from './Icons.jsx'

// props:
// - onVoiceClick: function called when the Voice Assistant button is pressed
// - onNavigate: optional navigation function
// - currentPath: current URL path string
// - session: current farmer session object or null
// - onLogout: function called when logging out
export default function Header({ onVoiceClick, onNavigate, currentPath, session, onLogout }) {
  const { t, lang, toggleLang } = useLanguage()

  const handleBrandClick = () => {
    if (onNavigate) {
      onNavigate('/')
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
    currentPath.startsWith('/traceability')

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
            <IconLeaf />
          </span>
          <div className="brand-text">
            <span className="brand-title">{t.header.title}</span>
            <span className="brand-tagline">{t.header.tagline}</span>
          </div>
        </div>

        <div className="header-actions">
          {isPortalOrAuth && (
            <button
              className="btn btn-outline"
              onClick={() => onNavigate && onNavigate('/')}
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

          {session && currentPath !== '/dashboard' && (
            <button
              className="btn btn-outline header-btn-dashboard"
              onClick={() => onNavigate && onNavigate('/dashboard')}
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

          {session && currentPath !== '/hub' && (
            <button
              className="btn btn-outline header-btn-hub"
              onClick={() => onNavigate && onNavigate('/hub')}
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

          {session && currentPath !== '/logistics' && (
            <button
              className="btn btn-outline header-btn-logistics"
              onClick={() => onNavigate && onNavigate('/logistics')}
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

          {!currentPath.startsWith('/traceability') && (
            <button
              className="btn btn-outline header-btn-traceability"
              onClick={() => onNavigate && onNavigate('/traceability')}
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

          {!session && currentPath !== '/auth' && (
            <button
              className="btn btn-outline header-btn-auth"
              onClick={() => onNavigate && onNavigate('/auth')}
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

          {session && (
            <div className="header-farmer-badge header-user-badge">
              <span className="header-farmer-name">
                {session.name.split(' ')[0]}
              </span>
              <button
                type="button"
                className="header-btn-logout"
                onClick={onLogout}
                title={t.unifiedAuth?.logout || t.auth?.logout || 'Log Out'}
              >
                {t.unifiedAuth?.logout || t.auth?.logout || 'Log Out'}
              </button>
            </div>
          )}

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
        </div>
      </div>
    </header>
  )
}

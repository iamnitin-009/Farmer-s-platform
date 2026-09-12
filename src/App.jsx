import React, { Component, useState, useEffect } from 'react'
import { LanguageProvider, useLanguage } from './context/LanguageContext.jsx'
import Header from './components/Header.jsx'
import Hero from './components/Hero.jsx'
import HowItWorks from './components/HowItWorks.jsx'
import PlatformFeatures from './components/PlatformFeatures.jsx'
import FarmerPortal from './components/FarmerPortal.jsx'
import AuthPage from './pages/AuthPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import AdminDashboardPage from './pages/AdminDashboardPage.jsx'
import BuyerMarketplacePage from './pages/BuyerMarketplacePage.jsx'
import HubAggregationPage from './pages/HubAggregationPage.jsx'
import LogisticsRoutePage from './pages/LogisticsRoutePage.jsx'
import TraceabilityPage from './pages/TraceabilityPage.jsx'
import VoiceAssistant from './components/VoiceAssistant.jsx'
import Footer from './components/Footer.jsx'
import { getCurrentUser, logoutUser } from './utils/auth.js'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('App ErrorBoundary caught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px 20px', textAlign: 'center', maxWidth: '600px', margin: '40px auto', background: '#fff', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🌾</div>
          <h2 style={{ color: '#166534', marginBottom: '10px' }}>Something went wrong</h2>
          <p style={{ color: '#64748b', marginBottom: '24px', fontSize: '0.95rem' }}>
            {this.state.error?.message || 'An unexpected error occurred while rendering the page.'}
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
            >
              ↻ Reload Page
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                this.setState({ hasError: false, error: null })
                if (this.props.onNavigate) this.props.onNavigate('/dashboard')
                else window.location.href = '/dashboard'
              }}
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// App.jsx coordinates top-level routing between '/', '/auth', '/dashboard', '/farmer', '/buyer', '/admin', and '/traceability'
// wrapped in LanguageProvider so language state is shared globally.
export default function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname)

  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = (path) => {
    window.history.pushState({}, '', path)
    setCurrentPath(path)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <LanguageProvider>
      <MainApp currentPath={currentPath} onNavigate={navigate} />
    </LanguageProvider>
  )
}

function MainApp({ currentPath, onNavigate }) {
  const { t } = useLanguage()

  // Unified user session state from localStorage
  const [session, setSession] = useState(() => getCurrentUser())

  const handleAuthSuccess = (newSession) => {
    setSession(newSession)
    if (newSession?.role === 'admin') {
      onNavigate('/admin')
    } else {
      onNavigate('/dashboard')
    }
  }

  // Enforce session protection & role authorization on navigation
  useEffect(() => {
    // 1. Unauthenticated access to protected routes -> redirect to /auth
    if (!session) {
      if (
        currentPath === '/dashboard' ||
        currentPath === '/farmer' ||
        currentPath === '/buyer' ||
        currentPath === '/hub' ||
        currentPath === '/logistics' ||
        currentPath === '/admin' ||
        currentPath === '/farmer-auth'
      ) {
        onNavigate('/auth')
      }
    } else {
      // 2. Already authenticated visitor navigating to auth pages -> redirect to appropriate dashboard
      if (currentPath === '/auth' || currentPath === '/farmer-auth') {
        if (session.role === 'admin') {
          onNavigate('/admin')
        } else {
          onNavigate('/dashboard')
        }
      }
      // 3. Non-admin trying to access /admin -> redirect to user /dashboard
      else if (currentPath === '/admin' && session.role !== 'admin') {
        onNavigate('/dashboard')
      }
    }
  }, [currentPath, session, onNavigate])

  // Modal state ('voice' or null)
  const [openModal, setOpenModal] = useState(null)

  const handleLogout = () => {
    logoutUser()
    setSession(null)
    onNavigate('/auth')
  }

  const closeModal = () => setOpenModal(null)

  const isAdmin = currentPath === '/admin'
  const isDashboard = currentPath === '/dashboard'
  const isAuth = currentPath === '/auth' || currentPath === '/farmer-auth'
  const isFarmerPortal = currentPath === '/farmer'
  const isBuyerMarketplace = currentPath === '/buyer'
  const isHub = currentPath === '/hub'
  const isLogistics = currentPath === '/logistics'
  const isTraceability = currentPath.startsWith('/traceability')
  const traceabilityId = isTraceability
    ? currentPath.replace(/^\/traceability\/?/, '')
    : null

  return (
    <>
      <Header
        onVoiceClick={() => setOpenModal('voice')}
        onNavigate={onNavigate}
        currentPath={currentPath}
        session={session}
        onLogout={handleLogout}
      />

      <main>
        <ErrorBoundary onNavigate={onNavigate}>
        {isTraceability ? (
          <TraceabilityPage
            traceabilityId={traceabilityId}
            onNavigate={onNavigate}
            session={session}
          />
        ) : isAdmin ? (
          session?.role === 'admin' ? (
            <AdminDashboardPage
              session={session}
              onNavigate={onNavigate}
              onLogout={handleLogout}
            />
          ) : (
            <AuthPage
              onNavigate={onNavigate}
              onAuthSuccess={handleAuthSuccess}
            />
          )
        ) : isDashboard ? (
          session ? (
            <DashboardPage
              session={session}
              onNavigate={onNavigate}
              onLogout={handleLogout}
            />
          ) : (
            <AuthPage
              onNavigate={onNavigate}
              onAuthSuccess={handleAuthSuccess}
            />
          )
        ) : isAuth ? (
          <AuthPage
            onNavigate={onNavigate}
            onAuthSuccess={handleAuthSuccess}
          />
        ) : isFarmerPortal ? (
          session ? (
            <FarmerPortal
              onNavigate={onNavigate}
              session={session}
              onLogout={handleLogout}
            />
          ) : (
            <AuthPage
              onNavigate={onNavigate}
              onAuthSuccess={handleAuthSuccess}
            />
          )
        ) : isBuyerMarketplace ? (
          session ? (
            <BuyerMarketplacePage
              onNavigate={onNavigate}
              session={session}
            />
          ) : (
            <AuthPage
              onNavigate={onNavigate}
              onAuthSuccess={handleAuthSuccess}
            />
          )
        ) : isHub ? (
          session ? (
            <HubAggregationPage
              onNavigate={onNavigate}
              session={session}
            />
          ) : (
            <AuthPage
              onNavigate={onNavigate}
              onAuthSuccess={handleAuthSuccess}
            />
          )
        ) : isLogistics ? (
          session ? (
            <LogisticsRoutePage
              onNavigate={onNavigate}
              session={session}
            />
          ) : (
            <AuthPage
              onNavigate={onNavigate}
              onAuthSuccess={handleAuthSuccess}
            />
          )
        ) : (
          <>
            <Hero session={session} onNavigate={onNavigate} />
            <HowItWorks />
            <PlatformFeatures session={session} onNavigate={onNavigate} />
          </>
        )}
        </ErrorBoundary>
      </main>

      <Footer />

      {/* Floating Action Button for Voice Assistant */}
      <button
        className="voice-fab"
        onClick={() => setOpenModal('voice')}
        title={t.voiceAssistant?.title || 'AI Voice Assistant'}
        type="button"
        aria-label="Open AI Voice Assistant"
      >
        <span className="voice-fab-badge-pulse" />
        <span className="voice-fab-icon">🎙️</span>
        <span className="voice-fab-label">{t.header?.voiceAssistant || 'Voice AI'}</span>
      </button>

      {/* AI Voice Assistant Modal */}
      <VoiceAssistant
        isOpen={openModal === 'voice'}
        onClose={closeModal}
        session={session}
      />
    </>
  )
}


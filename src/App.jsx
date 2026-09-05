import { useState, useEffect } from 'react'
import { LanguageProvider, useLanguage } from './context/LanguageContext.jsx'
import Header from './components/Header.jsx'
import Hero from './components/Hero.jsx'
import HowItWorks from './components/HowItWorks.jsx'
import PlatformFeatures from './components/PlatformFeatures.jsx'
import FarmerPortal from './components/FarmerPortal.jsx'
import AuthPage from './pages/AuthPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import BuyerMarketplacePage from './pages/BuyerMarketplacePage.jsx'
import HubAggregationPage from './pages/HubAggregationPage.jsx'
import LogisticsRoutePage from './pages/LogisticsRoutePage.jsx'
import TraceabilityPage from './pages/TraceabilityPage.jsx'
import VoiceAssistant from './components/VoiceAssistant.jsx'
import Footer from './components/Footer.jsx'
import { getCurrentUser, logoutUser } from './utils/auth.js'

// App.jsx coordinates top-level routing between '/', '/auth', '/dashboard', '/farmer', '/buyer', and '/traceability'
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
    onNavigate('/dashboard')
  }

  // Enforce session protection on navigation
  useEffect(() => {
    // Unauthenticated access to protected routes -> redirect to /auth
    if (!session) {
      if (
        currentPath === '/dashboard' ||
        currentPath === '/farmer' ||
        currentPath === '/buyer' ||
        currentPath === '/hub' ||
        currentPath === '/logistics' ||
        currentPath === '/farmer-auth'
      ) {
        onNavigate('/auth')
      }
    }
    // Already authenticated visitor navigating to auth pages -> redirect to /dashboard
    else if (currentPath === '/auth' || currentPath === '/farmer-auth') {
      onNavigate('/dashboard')
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
        {isTraceability ? (
          <TraceabilityPage
            traceabilityId={traceabilityId}
            onNavigate={onNavigate}
            session={session}
          />
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


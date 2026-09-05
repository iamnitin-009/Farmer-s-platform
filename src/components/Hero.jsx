import { useLanguage } from '../context/LanguageContext.jsx'

// props:
// - session: active user session or null
// - onNavigate: navigation function
export default function Hero({ session, onNavigate }) {
  const { t } = useLanguage()

  const handleHeroCta = () => {
    if (session) {
      onNavigate('/dashboard')
    } else {
      onNavigate('/auth')
    }
  }

  return (
    <section className="hero">
      <div className="hero-inner">
        <div className="hero-text">
          <h1>{t.hero.title}</h1>
          <p className="hero-subtitle">{t.hero.subtitle}</p>

          <div className="hero-ctas">
            <button
              className="btn btn-primary btn-hero-main"
              onClick={handleHeroCta}
              type="button"
            >
              {session
                ? (t.dashboard?.backToDashboard || 'Go to Dashboard')
                : (t.hero?.getStartedCta || 'Login / Get Started')}{' '}
              →
            </button>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <FarmToMarketArt />
        </div>
      </div>
    </section>
  )
}

// A simple, hand-drawn-style SVG showing: field -> arrow -> basket/market.
// This replaces a generic gradient-blob hero image with something that
// actually reflects the subject matter (farm produce moving to market).
function FarmToMarketArt() {
  return (
    <svg viewBox="0 0 420 340" width="100%" height="100%" fill="none">
      {/* ground */}
      <path d="M0 270 C 90 250, 150 290, 240 265 C 320 245, 380 270, 420 260 V340 H0 Z" fill="#EDE7D5" />

      {/* rows of crops */}
      {[60, 100, 140, 180].map((x, i) => (
        <g key={i} transform={`translate(${x} 200)`}>
          <path d="M0 55 V15" stroke="#3E6B2E" strokeWidth="4" strokeLinecap="round" />
          <path d="M0 30 C -14 22, -16 8, -6 0" stroke="#5A8F3C" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M0 22 C 14 14, 16 0, 6 -8" stroke="#5A8F3C" strokeWidth="4" strokeLinecap="round" fill="none" />
        </g>
      ))}

      {/* arrow */}
      <path d="M215 130 H300" stroke="#D9A441" strokeWidth="4" strokeLinecap="round" />
      <path d="M288 118 L302 130 L288 142" stroke="#D9A441" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* basket / market crate */}
      <g transform="translate(310 95)">
        <path d="M0 35h70l-7 38a8 8 0 0 1-8 7H15a8 8 0 0 1-8-7L0 35Z" fill="#16321F" opacity="0.08" />
        <path d="M0 35h70l-7 38a8 8 0 0 1-8 7H15a8 8 0 0 1-8-7L0 35Z" stroke="#16321F" strokeWidth="3" strokeLinejoin="round" />
        <path d="M13 35 22 8M57 35 48 8M-4 35h78" stroke="#16321F" strokeWidth="3" strokeLinecap="round" />
      </g>

      {/* sun */}
      <circle cx="70" cy="55" r="24" fill="#D9A441" opacity="0.9" />
    </svg>
  )
}

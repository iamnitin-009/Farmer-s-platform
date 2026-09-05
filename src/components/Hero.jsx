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

// Hero illustration
function FarmToMarketArt() {
  return (
    <img
      src="/images/title_image.png"
      alt=""
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
      }}
    />
  )
}
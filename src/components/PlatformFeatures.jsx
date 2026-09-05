import { useLanguage } from '../context/LanguageContext.jsx'
import { IconSprout, IconBasket } from './Icons.jsx'

// props:
// - session: active user session or null
// - onNavigate: navigation function
export default function PlatformFeatures({ session, onNavigate }) {
  const { t } = useLanguage()
  const pT = t.platformFeatures || {}

  const handleAction = (target) => {
    if (session) {
      onNavigate(target)
    } else {
      onNavigate('/auth')
    }
  }

  return (
    <section className="user-types platform-features" id="platform-features">
      <div className="section-inner">
        <h2>{pT.heading || 'One Unified Agricultural Platform'}</h2>
        <p className="section-subheading">
          {pT.subheading || 'One account lets you sell your produce and buy directly from farmers.'}
        </p>

        <div className="user-type-grid platform-actions-grid">
          {/* Action 1: Sell Produce */}
          <div className="user-type-card platform-action-card">
            <span className="user-type-icon">
              <IconSprout />
            </span>
            <h3>{pT.sell?.title || 'Sell Produce'}</h3>
            <p>
              {pT.sell?.desc ||
                'List your harvested crops, set your price, and reach buyers directly without middlemen.'}
            </p>
            <button
              className="btn btn-outline"
              onClick={() => handleAction('/farmer')}
              type="button"
            >
              {pT.sell?.button || 'Sell Produce'} →
            </button>
          </div>

          {/* Action 2: Buy Produce */}
          <div className="user-type-card platform-action-card">
            <span className="user-type-icon">
              <IconBasket />
            </span>
            <h3>{pT.buy?.title || 'Buy Produce'}</h3>
            <p>
              {pT.buy?.desc ||
                'Browse fresh farm produce directly from verified farmers at fair, transparent market rates.'}
            </p>
            <button
              className="btn btn-outline"
              onClick={() => handleAction('/buyer')}
              type="button"
            >
              {pT.buy?.button || 'Buy Produce'} →
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

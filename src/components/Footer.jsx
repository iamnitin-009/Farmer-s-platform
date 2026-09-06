import { useLanguage } from '../context/LanguageContext.jsx'
import { PragatiSymbol } from './PragatiLogo.jsx'

export default function Footer() {
  const { t } = useLanguage()
  return (
    <footer className="footer">
      <div className="footer-inner" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', opacity: 0.9 }}>
          <PragatiSymbol size={22} />
          <span style={{ fontWeight: 800, letterSpacing: '0.08em', fontSize: '0.95rem', color: '#ffffff' }}>
            PRAGATI
          </span>
        </div>
        <p>{t.footer.text}</p>
      </div>
    </footer>
  )
}

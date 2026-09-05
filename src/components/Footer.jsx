import { useLanguage } from '../context/LanguageContext.jsx'

export default function Footer() {
  const { t } = useLanguage()
  return (
    <footer className="footer">
      <p>{t.footer.text}</p>
    </footer>
  )
}

import React, { createContext, useContext, useState } from 'react'
import translations from '../translations.js'

// React Context lets us store "which language is selected" in ONE place
// (here) and read it from ANY component, without passing props down
// manually through every level. This is the standard beginner-friendly
// way to share global state like a language or theme setting.

const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  // Default language is English, as requested.
  const [lang, setLang] = useState('en')

  const toggleLang = () => {
    setLang((prev) => (prev === 'en' ? 'hi' : 'en'))
  }

  // `t` is just shorthand for "translations for the currently selected
  // language". Components use it like: t.hero.title
  const value = {
    lang,
    setLang,
    toggleLang,
    t: translations[lang],
  }

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

// Small helper hook so components just do: const { t, lang } = useLanguage()
export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used inside a LanguageProvider')
  }
  return context
}

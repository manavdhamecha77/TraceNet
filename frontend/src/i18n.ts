import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import hi from './locales/hi.json'
import gu from './locales/gu.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, hi: { translation: hi }, gu: { translation: gu } },
    fallbackLng: 'en',
    defaultNS: 'translation',
    lng: localStorage.getItem('tracenet_lang') || 'en',
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'], lookupLocalStorage: 'tracenet_lang' },
  })

export default i18n

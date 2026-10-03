import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './fr';
import type { Locale } from '@/lib/types';

const STORAGE_KEY = 'kuzuri-locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'fr';
}

void i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr } },
  lng: 'fr',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** English is code-split: only downloaded when selected. */
export async function setLocale(locale: Locale) {
  if (locale === 'en' && !i18n.hasResourceBundle('en', 'translation')) {
    const en = (await import('./en')).default;
    i18n.addResourceBundle('en', 'translation', en);
  }
  await i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

const start = initialLocale();
if (start !== 'fr') void setLocale(start);

export default i18n;

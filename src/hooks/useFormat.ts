import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/money';
import { zonedParts } from '@/lib/time';
import type { Locale } from '@/lib/types';

/** Locale-aware formatters for money and business-local dates/times. */
export function useFormat() {
  const { i18n } = useTranslation();
  const locale = (i18n.language === 'en' ? 'en' : 'fr') as Locale;
  const intl = locale === 'fr' ? 'fr-FR' : 'en-GB';
  return {
    locale,
    money: (n: number) => formatMoney(n, locale),
    time: (iso: string, tz: string) => zonedParts(iso, tz).time.replace(':', locale === 'fr' ? 'h' : ':'),
    /** « samedi 12 octobre » */
    longDate: (iso: string, tz: string) => new Intl.DateTimeFormat(intl, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date(iso)),
    /** « sam. 12 oct. » */
    shortDate: (iso: string, tz: string) => new Intl.DateTimeFormat(intl, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso)),
    weekday: (iso: string, tz: string) => new Intl.DateTimeFormat(intl, { weekday: 'long', timeZone: tz }).format(new Date(iso)),
    /** For a local YYYY-MM-DD date. */
    day: (date: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intl, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)),
    monthYear: (iso: string) => new Intl.DateTimeFormat(intl, { month: 'long', year: 'numeric' }).format(new Date(iso)),
    date: (iso: string) => new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)),
    dateTime: (iso: string) => new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)),
    duration: (min: number) => {
      const h = Math.floor(min / 60);
      const m = min % 60;
      if (!h) return `${m} min`;
      return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
    },
  };
}

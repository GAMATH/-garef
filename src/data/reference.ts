import type { Category, City, Country } from '@/lib/types';

/** Reference data — mirrors the `countries`, `cities` and `categories` seed rows. */
export const COUNTRIES: Country[] = [
  { code: 'CG', name: 'Congo', currency: 'XAF', dialCode: '+242', timezone: 'Africa/Brazzaville', operators: ['airtel_money', 'mtn_momo'], defaultLocale: 'fr', flag: '🇨🇬', phoneLength: 9 },
  { code: 'GA', name: 'Gabon', currency: 'XAF', dialCode: '+241', timezone: 'Africa/Libreville', operators: ['airtel_money', 'moov_money'], defaultLocale: 'fr', flag: '🇬🇦', phoneLength: 8 },
  { code: 'CM', name: 'Cameroun', currency: 'XAF', dialCode: '+237', timezone: 'Africa/Douala', operators: ['mtn_momo', 'orange_money'], defaultLocale: 'fr', flag: '🇨🇲', phoneLength: 9 },
  { code: 'CI', name: "Côte d'Ivoire", currency: 'XOF', dialCode: '+225', timezone: 'Africa/Abidjan', operators: ['orange_money', 'mtn_momo', 'moov_money', 'wave'], defaultLocale: 'fr', flag: '🇨🇮', phoneLength: 10 },
  { code: 'BJ', name: 'Bénin', currency: 'XOF', dialCode: '+229', timezone: 'Africa/Porto-Novo', operators: ['mtn_momo', 'moov_money'], defaultLocale: 'fr', flag: '🇧🇯', phoneLength: 10 },
  { code: 'TG', name: 'Togo', currency: 'XOF', dialCode: '+228', timezone: 'Africa/Lome', operators: ['moov_money'], defaultLocale: 'fr', flag: '🇹🇬', phoneLength: 8 },
];

export const CITIES: City[] = [
  { id: '0c000000-0000-4000-8000-000000000001', countryCode: 'CG', name: 'Brazzaville', slug: 'brazzaville', timezone: 'Africa/Brazzaville', lat: -4.2634, lng: 15.2429 },
  { id: '0c000000-0000-4000-8000-000000000002', countryCode: 'CG', name: 'Pointe-Noire', slug: 'pointe-noire', timezone: 'Africa/Brazzaville', lat: -4.7761, lng: 11.8635 },
  { id: '0c000000-0000-4000-8000-000000000003', countryCode: 'GA', name: 'Libreville', slug: 'libreville', timezone: 'Africa/Libreville', lat: 0.4162, lng: 9.4673 },
  { id: '0c000000-0000-4000-8000-000000000004', countryCode: 'CM', name: 'Douala', slug: 'douala', timezone: 'Africa/Douala', lat: 4.0511, lng: 9.7679 },
  { id: '0c000000-0000-4000-8000-000000000005', countryCode: 'CM', name: 'Yaoundé', slug: 'yaounde', timezone: 'Africa/Douala', lat: 3.848, lng: 11.5021 },
  { id: '0c000000-0000-4000-8000-000000000006', countryCode: 'CI', name: 'Abidjan', slug: 'abidjan', timezone: 'Africa/Abidjan', lat: 5.36, lng: -4.0083 },
  { id: '0c000000-0000-4000-8000-000000000007', countryCode: 'BJ', name: 'Cotonou', slug: 'cotonou', timezone: 'Africa/Porto-Novo', lat: 6.3703, lng: 2.3912 },
  { id: '0c000000-0000-4000-8000-000000000008', countryCode: 'TG', name: 'Lomé', slug: 'lome', timezone: 'Africa/Lome', lat: 6.1725, lng: 1.2314 },
];

export const CATEGORIES: Category[] = [
  { id: '0ca70000-0000-4000-8000-000000000001', slug: 'coupe-homme', key: 'menCut', sort: 1 },
  { id: '0ca70000-0000-4000-8000-000000000002', slug: 'barbe', key: 'beard', sort: 2 },
  { id: '0ca70000-0000-4000-8000-000000000003', slug: 'braids', key: 'braids', sort: 3 },
  { id: '0ca70000-0000-4000-8000-000000000004', slug: 'tissage', key: 'weave', sort: 4 },
  { id: '0ca70000-0000-4000-8000-000000000005', slug: 'locks', key: 'locs', sort: 5 },
  { id: '0ca70000-0000-4000-8000-000000000006', slug: 'manucure', key: 'manicure', sort: 6 },
  { id: '0ca70000-0000-4000-8000-000000000007', slug: 'pedicure', key: 'pedicure', sort: 7 },
  { id: '0ca70000-0000-4000-8000-000000000008', slug: 'soins-visage', key: 'facial', sort: 8 },
];

export const countryByCode = (code: string) => COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
export const cityById = (id: string) => CITIES.find((c) => c.id === id) ?? CITIES[0];
export const categoryBySlug = (slug: string) => CATEGORIES.find((c) => c.slug === slug);

/** Staff colours for the pro calendar (distinct, AA-legible with ink text on their soft tint). */
export const STAFF_COLORS = ['#C4532D', '#2F6B4F', '#D9A441', '#5B4B8A', '#2E6F95', '#9C4F7A', '#6B645C', '#B86E3D'];

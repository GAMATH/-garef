import type { Country } from './types';

/** Keeps digits only. */
export function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Strips the dial code if the user pasted an international number. */
export function nationalNumber(value: string, country: Country): string {
  let d = digits(value);
  const cc = digits(country.dialCode);
  if (d.startsWith('00' + cc)) d = d.slice(2 + cc.length);
  else if (d.startsWith(cc) && d.length > country.phoneLength) d = d.slice(cc.length);
  return d.slice(0, country.phoneLength);
}

export function isValidNational(value: string, country: Country): boolean {
  return nationalNumber(value, country).length === country.phoneLength;
}

/** E.164 format: +242061234567 */
export function toE164(value: string, country: Country): string {
  return `${country.dialCode}${nationalNumber(value, country)}`;
}

/** Local display grouping by pairs after the first group: « 06 123 45 67 ». */
export function formatNational(value: string, country: Country): string {
  const d = nationalNumber(value, country);
  if (!d) return '';
  const groups: string[] = [];
  const first = d.length > 8 ? 2 : 2;
  groups.push(d.slice(0, first));
  let rest = d.slice(first);
  if (rest.length % 2 === 1) {
    groups.push(rest.slice(0, 3));
    rest = rest.slice(3);
  }
  while (rest.length) {
    groups.push(rest.slice(0, 2));
    rest = rest.slice(2);
  }
  return groups.filter(Boolean).join(' ');
}

export function formatE164(e164: string, countries: Country[]): string {
  const c = countries.find((x) => e164.startsWith(x.dialCode));
  if (!c) return e164;
  return `${c.dialCode} ${formatNational(e164.slice(c.dialCode.length), c)}`;
}

export function whatsappLink(e164: string, message: string): string {
  return `https://wa.me/${digits(e164)}?text=${encodeURIComponent(message)}`;
}

import { forwardRef, useId } from 'react';
import clsx from 'clsx';
import type { Country } from '@/lib/types';
import { formatNational, nationalNumber } from '@/lib/phone';
import { FieldShell } from './Field';

interface Props {
  label: string;
  country: Country;
  countries?: Country[];
  onCountryChange?: (code: string) => void;
  value: string;
  onChange: (national: string) => void;
  error?: string;
  hint?: string;
  autoFocus?: boolean;
}

/** Phone input with country dial code prefilled; stores national digits, displays local grouping. */
export const PhoneInput = forwardRef<HTMLInputElement, Props>(function PhoneInput({ label, country, countries, onCountryChange, value, onChange, error, hint, autoFocus }, ref) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <div className={clsx('flex min-h-tap overflow-hidden rounded-card border bg-surface focus-within:border-terracotta focus-within:ring-2 focus-within:ring-terracotta/20', error ? 'border-danger' : 'border-sand')}>
        {countries && onCountryChange ? (
          <select
            aria-label={label}
            value={country.code}
            onChange={(e) => onCountryChange(e.target.value)}
            className="appearance-none border-r border-sand bg-sand-light pl-3 pr-2 text-base font-medium focus:outline-none"
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.dialCode}
              </option>
            ))}
          </select>
        ) : (
          <span className="flex items-center border-r border-sand bg-sand-light px-3 font-medium" aria-hidden>
            {country.flag} {country.dialCode}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          autoFocus={autoFocus}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          value={formatNational(value, country)}
          onChange={(e) => onChange(nationalNumber(e.target.value, country))}
          placeholder={formatNational('0'.padEnd(country.phoneLength, '1'), country)}
          className="min-w-0 flex-1 bg-transparent px-3 text-base placeholder:text-stone/60 focus:outline-none"
        />
      </div>
    </FieldShell>
  );
});

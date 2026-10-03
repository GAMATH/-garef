import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Api, Reference } from '@/data/api';
import type { Country, Profile } from '@/lib/types';
import { setLocale } from '@/i18n';

interface AppContextValue {
  api: Api;
  ref: Reference;
  profile: Profile | null;
  setProfile: (p: Profile | null) => void;
  signOut: () => Promise<void>;
  country: Country;
  setCountryCode: (code: string) => void;
}

const Ctx = createContext<AppContextValue | null>(null);
const COUNTRY_KEY = 'kuzuri-country';

function savedCountry(): string {
  try {
    return localStorage.getItem(COUNTRY_KEY) ?? 'CG';
  } catch {
    return 'CG';
  }
}

export function AppProvider({ api, children, fallback }: { api: Api; children: ReactNode; fallback: ReactNode }) {
  const qc = useQueryClient();
  const refQ = useQuery({ queryKey: ['reference'], queryFn: () => api.getReference(), staleTime: 60 * 60 * 1000 });
  const sessionQ = useQuery({ queryKey: ['session'], queryFn: () => api.getSession(), staleTime: Infinity });
  const [countryCode, setCode] = useState(savedCountry);

  const setProfile = useCallback(
    (p: Profile | null) => {
      qc.setQueryData(['session'], p);
      if (p?.locale) void setLocale(p.locale);
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    await api.signOut();
    qc.setQueryData(['session'], null);
    qc.removeQueries({ queryKey: ['me'] });
  }, [api, qc]);

  const setCountryCode = useCallback((code: string) => {
    setCode(code);
    try {
      localStorage.setItem(COUNTRY_KEY, code);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const p = sessionQ.data;
    if (p?.countryCode && !localStorage.getItem(COUNTRY_KEY)) setCode(p.countryCode);
  }, [sessionQ.data]);

  const value = useMemo<AppContextValue | null>(() => {
    if (!refQ.data || sessionQ.isPending) return null;
    const country = refQ.data.countries.find((c) => c.code === countryCode) ?? refQ.data.countries[0];
    return { api, ref: refQ.data, profile: sessionQ.data ?? null, setProfile, signOut, country, setCountryCode };
  }, [api, refQ.data, sessionQ.data, sessionQ.isPending, countryCode, setProfile, signOut, setCountryCode]);

  if (!value) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export const useApi = () => useApp().api;

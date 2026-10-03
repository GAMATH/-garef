import type { Api } from './api';
import i18n from '@/i18n';

let apiPromise: Promise<Api> | null = null;

export const isSupabaseConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

/** Resolves the active data adapter. Each adapter is its own lazy chunk. */
export function loadApi(): Promise<Api> {
  if (!apiPromise) {
    apiPromise = isSupabaseConfigured
      ? import('./supabase/supabaseApi').then((m) => new m.SupabaseApi(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY))
      : import('./demo/demoApi').then((m) => new m.DemoApi({ t: (key, vars) => i18n.t(key as never, vars as never) as unknown as string }));
  }
  return apiPromise;
}

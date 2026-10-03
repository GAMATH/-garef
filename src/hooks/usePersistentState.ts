import { useEffect, useState } from 'react';

/**
 * State mirrored in sessionStorage: forms keep their input across a network drop,
 * a reload or an accidental back navigation.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value]);
  const clear = () => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };
  return [value, setValue, clear] as const;
}

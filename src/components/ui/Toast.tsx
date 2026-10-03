import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

type Tone = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; tone: Tone }
const Ctx = createContext<(message: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, message, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3800);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite" role="status">
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto flex max-w-md items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-soft animate-fade-up',
              t.tone === 'success' && 'bg-ink text-ivory',
              t.tone === 'error' && 'bg-danger text-white',
              t.tone === 'info' && 'bg-surface text-ink border border-sand',
            )}
          >
            {t.tone === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-forest-soft" strokeWidth={1.75} /> : t.tone === 'error' ? <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.75} /> : <Info className="h-4 w-4 shrink-0" strokeWidth={1.75} />}
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

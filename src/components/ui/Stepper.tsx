import clsx from 'clsx';

/** Discreet progress indicator: thin segments + current step label. */
export function Stepper({ steps, current, label }: { steps: number; current: number; label: string }) {
  return (
    <div aria-label={label}>
      <div className="flex gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={steps} aria-valuenow={current + 1}>
        {Array.from({ length: steps }, (_, i) => (
          <div key={i} className={clsx('h-1 flex-1 rounded-full transition-colors duration-250', i <= current ? 'bg-terracotta' : 'bg-sand')} />
        ))}
      </div>
    </div>
  );
}

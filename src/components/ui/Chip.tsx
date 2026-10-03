import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Chip({ active, icon, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={clsx(
        'inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors duration-150 active:scale-[0.97]',
        active ? 'border-ink bg-ink text-ivory' : 'border-sand bg-surface text-ink hover:border-ink/40',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

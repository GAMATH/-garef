import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg' | 'sm';

const base =
  'inline-flex select-none items-center justify-center gap-2 rounded-full font-bold transition-[background-color,color,transform,box-shadow] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50';
const variants: Record<Variant, string> = {
  primary: 'bg-terracotta text-white hover:bg-terracotta-dark active:bg-terracotta-dark',
  secondary: 'border border-ink/15 bg-surface text-ink hover:border-ink/40',
  ghost: 'text-ink hover:bg-sand/60',
  danger: 'border border-danger/30 bg-surface text-danger hover:bg-danger-soft',
};
const sizes: Record<Size, string> = {
  sm: 'min-h-[36px] px-4 text-sm',
  md: 'min-h-tap px-5 text-base',
  lg: 'min-h-[52px] px-6 text-base',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', block = false, extra?: string) {
  return clsx(base, variants[variant], sizes[size], block && 'w-full', extra);
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', block, loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, block, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.75} aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = 'primary', size = 'md', block, className, ...rest }: LinkProps & { variant?: Variant; size?: Size; block?: boolean }) {
  return <Link className={buttonClass(variant, size, block, className)} {...rest} />;
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors duration-150 hover:bg-sand/60 active:scale-95', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

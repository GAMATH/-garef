/**
 * Brand artwork. All images are generated SVG (≈1 KB, rights-free, warm and homogeneous):
 * no network request, no layout shift, works offline.
 */
import { memo } from 'react';
import clsx from 'clsx';

const PALETTES = [
  ['#C4532D', '#E9A27A', '#F6E4DC'],
  ['#A3431F', '#D9A441', '#F7EBD2'],
  ['#2F6B4F', '#D9A441', '#E8E1D6'],
  ['#6B3A26', '#C4532D', '#F2EDE5'],
  ['#8A5A2B', '#E2B66B', '#FAF7F2'],
  ['#5B4B8A', '#E9A27A', '#F6E4DC'],
];

/** Signature motif inspired by woven textiles — used only in the hero and the confirmation screen. */
export function Pattern({ className, color = '#C4532D', opacity = 0.12 }: { className?: string; color?: string; opacity?: number }) {
  return (
    <svg className={clsx('pointer-events-none', className)} aria-hidden width="100%" height="100%">
      <defs>
        <pattern id="kz-weave" width="48" height="48" patternUnits="userSpaceOnUse">
          <g fill="none" stroke={color} strokeWidth="2" opacity={opacity * 6}>
            <path d="M0 24 12 12l12 12-12 12zM24 24l12-12 12 12-12 12z" />
            <path d="M12 0v6M36 0v6M12 42v6M36 42v6" />
          </g>
          <g fill={color} opacity={opacity * 4}>
            <path d="M24 2l4 4-4 4-4-4zM24 38l4 4-4 4-4-4z" />
            <circle cx="12" cy="24" r="2" />
            <circle cx="36" cy="24" r="2" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#kz-weave)" />
    </svg>
  );
}

/** Warm placeholder "photo" for a salon, deterministic from a seed. */
export const SalonArt = memo(function SalonArt({ seed, className, label }: { seed: number; className?: string; label?: string }) {
  const [a, b, c] = PALETTES[seed % PALETTES.length];
  const shape = seed % 4;
  const r = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280;
  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className={clsx('block h-full w-full', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect width="400" height="300" fill={c} />
      <circle cx={80 + r(1) * 240} cy={60 + r(2) * 120} r={120 + r(3) * 60} fill={b} opacity="0.55" />
      {shape === 0 && <path d="M0 300 C120 180 260 260 400 150 V300Z" fill={a} />}
      {shape === 1 && <path d="M0 220 L120 120 L220 210 L300 140 L400 220 V300 H0Z" fill={a} />}
      {shape === 2 && (
        <g fill={a}>
          <rect x="40" y="150" width="70" height="150" rx="35" />
          <rect x="150" y="110" width="70" height="190" rx="35" />
          <rect x="260" y="170" width="70" height="130" rx="35" />
        </g>
      )}
      {shape === 3 && <ellipse cx="200" cy="330" rx="260" ry="150" fill={a} />}
      <g stroke={c} strokeWidth="3" fill="none" opacity="0.5">
        <path d={`M${30 + r(4) * 60} 40 l14 14 -14 14 -14 -14z`} />
        <path d={`M${300 + r(5) * 60} 60 l10 10 -10 10 -10 -10z`} />
      </g>
    </svg>
  );
});

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2 font-display text-xl font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 64 64" className="h-7 w-7" aria-hidden>
        <rect width="64" height="64" rx="16" fill="#C4532D" />
        <path d="M22 16v32M22 32l18-16M28 27l14 21" stroke="#FAF7F2" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      Kuzuri
    </span>
  );
}

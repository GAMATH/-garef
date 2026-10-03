import clsx from 'clsx';
import { Users } from 'lucide-react';

export function StaffAvatar({ name, color = '#C4532D', size = 48, className, any }: { name: string; color?: string; size?: number; className?: string; any?: boolean }) {
  return (
    <span
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-full font-bold', className)}
      style={{ width: size, height: size, background: any ? '#F2EDE5' : `${color}22`, color: any ? '#1A1714' : color, fontSize: size * 0.38 }}
      aria-hidden
    >
      {any ? <Users strokeWidth={1.75} style={{ width: size * 0.45, height: size * 0.45 }} /> : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

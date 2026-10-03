import { Logo } from '@/components/ui/Art';

export function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ivory" aria-busy="true">
      <Logo className="animate-fade-up" />
    </div>
  );
}

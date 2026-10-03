import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

export function QrCode({ value, size = 144, label }: { value: string; size?: number; label: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }, [value]);
  return <div role="img" aria-label={label} style={{ width: size, height: size }} className="[&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// Verifies the performance budget of section 9: initial JS < 180 KB gzip, no image > 120 KB.
// Initial JS = entry + modulepreloads + the data adapter chunk loaded at boot (demo mode).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = readdirSync(join(dist, 'assets'));
const gz = (f) => gzipSync(readFileSync(join(dist, f))).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const initial = [
  ...[...html.matchAll(/<script[^>]+src="\/([^"]+\.js)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/rel="modulepreload"[^>]+href="\/([^"]+)"/g)].map((m) => m[1]),
  ...assets.filter((f) => /^demoApi-.*\.js$/.test(f)).map((f) => `assets/${f}`),
];
let total = 0;
for (const f of initial) {
  const size = gz(f);
  total += size;
  console.log(`  ${f.padEnd(42)} ${kb(size)}`);
}
const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/([^"]+)"/g)].map((m) => m[1]);
console.log(`Initial JS (gzip): ${kb(total)} / 180 KB budget`);
console.log(`Initial CSS (gzip): ${kb(css.reduce((s, f) => s + gz(f), 0))}`);

const images = assets.filter((f) => /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(f)).map((f) => [f, statSync(join(dist, 'assets', f)).size]);
const heavy = images.filter(([, s]) => s > 120 * 1024);
console.log(`Images: ${images.length}, over 120 KB: ${heavy.length}`);

if (total > 180 * 1024 || heavy.length) {
  console.error('✗ Performance budget exceeded');
  process.exit(1);
}
console.log('✓ Performance budget respected');

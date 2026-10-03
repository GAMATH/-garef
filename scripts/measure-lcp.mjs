// Measures LCP of the home page under emulated slow networks (cold cache, 4× CPU slowdown).
// Usage: npm run build && npx vite preview --port 4173 & node scripts/measure-lcp.mjs
import { chromium } from '@playwright/test';

const profiles = {
  'slow 4G': { latency: 150, download: (1.6 * 1024 * 1024) / 8, upload: (750 * 1024) / 8 },
  '3G': { latency: 300, download: (750 * 1024) / 8, upload: (250 * 1024) / 8 },
};
const url = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch();
for (const [name, net] of Object.entries(profiles)) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.download, uploadThroughput: net.upload });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForTimeout(500);
  const lcp = await page.evaluate(() => window.__lcp);
  console.log(`${name.padEnd(8)} LCP ${(lcp / 1000).toFixed(2)} s`);
  await ctx.close();
}
await browser.close();

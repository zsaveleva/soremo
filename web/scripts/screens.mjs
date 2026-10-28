// Captures map screenshots into docs/screens. Requires dev servers running.
// Usage: node scripts/screens.mjs <name> [path] [zoom lon lat]
import { chromium } from '@playwright/test';

const [name = 'map', path = '/'] = process.argv.slice(2);
const base = process.env.WEB_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-objects][data-map-state="idle"]', { timeout: 30_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `../docs/screens/${name}-${w}.png` });
  if (errors.length) console.log(w, 'errors:', errors.join('\n'));
  await page.close();
}
await browser.close();

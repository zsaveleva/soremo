// Полностраничные скриншоты документных экранов: node scripts/page-shot.mjs <name> <path>
import { chromium } from '@playwright/test';

const [name, path = '/'] = process.argv.slice(2);
const base = process.env.WEB_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `../docs/screens/${name}-${w}.png`, fullPage: true });
  if (errors.length) console.log(w, errors.join('\n'));
  await page.close();
}
await browser.close();

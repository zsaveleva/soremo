// Снимки страницы частями для визуального ревью: .cache/review/<name>-<w>-<n>.png
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [name, path = '/', width = '1440'] = process.argv.slice(2);
const w = Number(width);
const h = w > 600 ? 1000 : 844;
mkdirSync('../.cache/review', { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: w, height: h } });
await page.goto((process.env.WEB_URL ?? 'http://localhost:5173') + path, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const total = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0, n = 0; y < total; y += h, n++) {
  await page.screenshot({ path: `../.cache/review/${name}-${w}-${n}.png`, clip: { x: 0, y, width: w, height: Math.min(h, total - y) }, fullPage: true });
}
console.log('parts', Math.ceil(total / h));
await browser.close();

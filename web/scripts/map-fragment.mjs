// Снимает статичный фрагмент карты (Нарвская застава) для экрана регистрации
// и витрины компонентов: public/map/fragment.jpg. Нужен запущенный dev-сервер.
import { chromium } from '@playwright/test';

const base = process.env.WEB_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1.5 });
await page.goto(`${base}/#15.7/59.8885/30.3175`, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'header, .maplibregl-control-container, [role=tooltip] { display: none !important; }' });
await page.waitForSelector('[data-objects][data-map-state="idle"]', { timeout: 30_000 });
await page.waitForTimeout(300);
await page.screenshot({ path: 'public/map/fragment.jpg', type: 'jpeg', quality: 78 });
await browser.close();

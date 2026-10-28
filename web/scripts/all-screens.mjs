// Скриншоты всех экранов на 1440 и 390 px в docs/screens (DoD 7).
// Нужен запущенный стек и сид: демо-пользователь demo@soremo.local и админ.
import { chromium } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';

const base = process.env.WEB_URL ?? 'http://localhost:5173';
const out = '../docs/screens';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });

async function login(page, email, password) {
  await page.goto(base + '/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/account|admin/);
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  if (await page.locator('[data-map-state]').count()) {
    await page.waitForSelector('[data-objects][data-map-state="idle"]', { timeout: 30_000 }).catch(() => {});
  }
  await page.waitForTimeout(400);
}

async function shoot(page, name, { full = true } = {}) {
  await settle(page);
  const w = page.viewportSize().width;
  await page.screenshot({ path: `${out}/${name}-${w}.png`, fullPage: full });
  console.log('✓', name, w);
}

const anyBuilding = async (page) => {
  const r = await page.request.get(base + '/api/v1/buildings?bbox=29.42,59.63,30.76,60.25&zoom=14&function=industrial&has_docs=false');
  const fs = (await r.json()).features.filter((f) => !f.properties.is_demo);
  return fs[Math.floor(Math.random() * fs.length)];
};

for (const [w, h] of [[1440, 900], [390, 844]]) {
  // Гость
  const g = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  await g.goto(base + '/');
  await shoot(g, '01-home', { full: false });
  await g.getByRole('button', { name: 'Фильтры' }).click();
  await shoot(g, '02-home-filters', { full: false });
  await g.getByRole('button', { name: 'Как это работает' }).click();
  await shoot(g, '03-home-about', { full: false });
  await g.goto(base + '/map?b=2#15.6/59.8905/30.3153');
  await shoot(g, '04-object-demo', { full: false });
  await g.goto(base + '/map?b=40#16/59.9055/30.3500');
  await shoot(g, '05-object-guest', { full: false });
  await g.goto(base + '/demo/1');
  await shoot(g, '06-report-demo-high');
  await g.goto(base + '/demo/3');
  await shoot(g, '07-report-demo-low');
  await g.goto(base + '/signup');
  await shoot(g, '08-signup');
  await g.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await shoot(g, '09-signup-errors');
  await g.goto(base + '/login');
  await shoot(g, '10-login');
  await g.goto(base + '/pricing');
  await shoot(g, '11-pricing');
  await g.goto(base + '/design');
  await shoot(g, '12-design-system');
  await g.goto(base + '/no-such-page');
  await shoot(g, '13-not-found');

  // Пользователь с пакетом
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const u = await ctx.newPage();
  await login(u, 'demo@soremo.local', 'demo1234');
  await u.goto(base + '/account?tab=access');
  await shoot(u, '14-account-access');
  const b = await anyBuilding(u);
  await u.goto(`${base}/map?b=${b.id}`);
  await shoot(u, '15-object-with-access', { full: false });
  await u.getByRole('button', { name: 'Смоделировать сценарии' }).click();
  await u.getByRole('heading', { name: 'Моделируем сценарии' }).waitFor();
  await u.waitForTimeout(3300);
  await u.screenshot({ path: `${out}/16-modelling-${w}.png` });
  console.log('✓ 16-modelling', w);
  await u.getByRole('heading', { name: 'Резюме' }).waitFor({ timeout: 30_000 });
  await shoot(u, '17-report-user');
  await u.goto(base + '/account?tab=objects');
  await shoot(u, '18-account-objects');
  await u.goto(base + '/account?tab=docs');
  await shoot(u, '19-account-documents');
  await u.goto(`${base}/objects/${b.id}/documents`);
  await u.locator('input[type=file]').setInputFiles('e2e/fixtures/techzaklyuchenie.pdf');
  await shoot(u, '20-documents-upload');
  await u.goto(base + '/objects/new?address=Кожевенная линия, 40');
  await shoot(u, '21-add-object', { full: w > 600 });
  await u.goto(base + '/pricing?objects=25&months=6');
  await shoot(u, '22-pricing-signed-in');
  await u.getByRole('button', { name: 'Перейти к оплате' }).click();
  await u.getByRole('heading', { name: 'Оплата' }).waitFor();
  await shoot(u, '23-checkout');
  await u.getByRole('button', { name: /Оплатить/ }).click();
  await shoot(u, '24-checkout-errors');
  await ctx.close();

  // Админ
  const a = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  await login(a, 'admin@soremo.local', 'admin1234');
  await a.goto(base + '/admin?tab=documents');
  await shoot(a, '25-admin-documents');
  const firstDoc = a.getByRole('button', { name: /\.pdf$/ }).first();
  if (await firstDoc.count()) {
    await firstDoc.click();
    await a.waitForTimeout(1200);
    await a.screenshot({ path: `${out}/26-admin-review-${w}.png` });
    console.log('✓ 26-admin-review', w);
    await a.keyboard.press('Escape');
  }
  await a.goto(base + '/admin?tab=payments');
  await shoot(a, '27-admin-payments');
}
await browser.close();

// Аудит мобильной вёрстки: горизонтальный скролл, вылезающие элементы, зоны нажатия,
// шрифт полей ввода (iOS увеличивает страницу при фокусе, если < 16 px), мелкий текст.
// node scripts/mobile-audit.mjs [ширины через запятую] → .cache/mobile/report.json и скриншоты.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.env.WEB_URL ?? 'http://localhost:5173';
const widths = (process.argv[2] ?? '360,390,414').split(',').map(Number);
const out = '../.cache/mobile';
mkdirSync(out, { recursive: true });

const SCREENS = [
  { name: 'home', path: '/', who: 'guest' },
  { name: 'home-filters', path: '/', who: 'guest', act: (p) => p.getByRole('button', { name: 'Фильтры' }).click() },
  { name: 'home-list', path: '/', who: 'guest', act: (p) => p.getByRole('button', { name: 'Списком' }).click() },
  { name: 'home-about', path: '/', who: 'guest', act: (p) => p.getByRole('button', { name: 'Как это работает' }).click() },
  { name: 'home-search', path: '/', who: 'guest', act: (p) => p.getByRole('combobox').fill('Заставская') },
  { name: 'object-sheet', path: '/map?b=2', who: 'guest' },
  { name: 'object-sheet-expanded', path: '/map?b=2', who: 'guest', act: (p) => p.getByRole('button', { name: 'Развернуть карточку' }).click() },
  { name: 'object-guest', path: '/map?b=40', who: 'guest', act: (p) => p.getByRole('button', { name: 'Развернуть карточку' }).click() },
  { name: 'report-demo', path: '/demo/1', who: 'guest' },
  { name: 'signup', path: '/signup', who: 'guest' },
  { name: 'signup-errors', path: '/signup', who: 'guest', act: (p) => p.getByRole('button', { name: 'Зарегистрироваться' }).click() },
  { name: 'login', path: '/login', who: 'guest' },
  { name: 'pricing', path: '/pricing', who: 'guest' },
  { name: 'design', path: '/design', who: 'guest' },
  { name: 'not-found', path: '/nope', who: 'guest' },
  { name: 'account-access', path: '/account?tab=access', who: 'user' },
  { name: 'account-objects', path: '/account?tab=objects', who: 'user' },
  { name: 'account-docs', path: '/account?tab=docs', who: 'user' },
  { name: 'object-user', path: '/map?b=40', who: 'user', act: (p) => p.getByRole('button', { name: 'Развернуть карточку' }).click() },
  { name: 'report-user', path: 'REPORT', who: 'user' },
  { name: 'documents', path: '/objects/40/documents', who: 'user', act: (p) => p.locator('input[type=file]').setInputFiles('e2e/fixtures/techzaklyuchenie.pdf') },
  { name: 'add-object', path: '/objects/new', who: 'user' },
  { name: 'checkout', path: '/pricing?objects=5&months=3', who: 'user', act: async (p) => { await p.getByRole('button', { name: 'Перейти к оплате' }).click(); await p.getByRole('heading', { name: 'Оплата' }).waitFor(); } },
  { name: 'admin-docs', path: '/admin?tab=documents&status=', who: 'admin' },
  { name: 'admin-users', path: '/admin?tab=users', who: 'admin' },
  { name: 'admin-payments', path: '/admin?tab=payments', who: 'admin' },
];

const CREDS = { user: ['demo@soremo.local', 'demo1234'], admin: ['admin@soremo.local', 'admin1234'] };

async function login(page, who) {
  await page.goto(base + '/login');
  await page.getByLabel('Email').fill(CREDS[who][0]);
  await page.getByLabel('Пароль').fill(CREDS[who][1]);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/account|admin/);
}

// Выполняется в странице: собирает нарушения.
function inspect() {
  const vw = document.documentElement.clientWidth;
  const res = { overflowX: document.documentElement.scrollWidth - vw, offscreen: [], smallTargets: [], smallInputs: [], tinyText: [] };
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().replace(/\s+/g, ' ');
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0].replace(/^_?/, '').slice(0, 24) : ''} «${t.slice(0, 40)}»`;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };
  // Внутри контейнера с собственной прокруткой выход за экран допустим (таблицы, вкладки).
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === 'auto' || ox === 'scroll' || ox === 'hidden') && p.scrollWidth > p.clientWidth) return true;
      if (ox === 'hidden') return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('.maplibregl-canvas-container, .maplibregl-ctrl-attrib, svg')) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el) && getComputedStyle(el).position !== 'fixed') res.offscreen.push(`${label(el)} [${Math.round(r.left)}…${Math.round(r.right)}]`);
  }
  const interactive = document.querySelectorAll('a[href], button, input:not([type=hidden]):not([type=file]), select, textarea, [role=tab], [role=option], label:has(input[type=radio]), label:has(input[type=checkbox])');
  for (const el of interactive) {
    if (!visible(el)) continue;
    if (el.matches('input[type=radio], input[type=checkbox]') && el.closest('label')) continue;
    if (el.matches('input[type=range]')) continue;
    const r = el.getBoundingClientRect();
    // Ссылки внутри абзаца текста — исключение WCAG 2.5.8 (inline).
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li, dd, td, span');
    if (!inline && (r.height < 44 || r.width < 44)) res.smallTargets.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    if (el.matches('input, select, textarea') && parseFloat(getComputedStyle(el).fontSize) < 16) res.smallInputs.push(`${label(el)} ${getComputedStyle(el).fontSize}`);
  }
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.children.length || !el.textContent.trim() || el.closest('.maplibregl-ctrl-attrib, svg')) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) res.tinyText.push(`${label(el)} ${fs}px`);
  }
  for (const k of ['offscreen', 'smallTargets', 'smallInputs', 'tinyText']) res[k] = [...new Set(res[k])];
  return res;
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const report = {};
const sizes = widths.map((w) => [w, w === 360 ? 740 : 844]).concat([[844, 390]]);
for (const [w, h] of sizes) {
  const pages = {};
  for (const who of ['guest', 'user', 'admin']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 600, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    if (who !== 'guest') await login(page, who);
    pages[who] = page;
  }
  let reportPath = null;
  for (const s of SCREENS) {
    const page = pages[s.who];
    let path = s.path;
    if (path === 'REPORT') {
      if (!reportPath) {
        const r = await page.request.get(base + '/api/v1/me/reports', { headers: { Authorization: 'Bearer ' + (await page.evaluate(() => '')) } });
        void r;
        await page.goto(base + '/account?tab=objects');
        await page.locator('tbody tr').first().click();
        await page.getByRole('heading', { name: 'Резюме' }).waitFor({ timeout: 30000 });
        reportPath = new URL(page.url()).pathname;
      }
      path = reportPath;
    }
    await page.goto(base + path);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    if (s.act) await s.act(page).catch((e) => console.log('  act failed', s.name, w, e.message.split('\n')[0]));
    await page.waitForTimeout(700);
    const r = await page.evaluate(inspect);
    report[`${s.name}@${w}x${h}`] = r;
    await page.screenshot({ path: `${out}/${s.name}-${w}x${h}.png`, fullPage: s.name.startsWith('home') || s.name.startsWith('object') ? false : true });
    const n = r.offscreen.length + r.smallTargets.length + r.smallInputs.length + r.tinyText.length + (r.overflowX > 0 ? 1 : 0);
    console.log(`${n ? '!' : '✓'} ${s.name.padEnd(22)} ${w}x${h}  overflow:${r.overflowX} off:${r.offscreen.length} targets:${r.smallTargets.length} inputs:${r.smallInputs.length} tiny:${r.tinyText.length}`);
  }
  for (const p of Object.values(pages)) await p.context().close();
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
await browser.close();

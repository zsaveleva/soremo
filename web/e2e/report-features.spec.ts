import { test, expect, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { BuildingCard, EngineOutput, Report } from '../src/api/types';
import { annotateStatic } from '../src/api/staticAnalysis';

const fc = JSON.parse(readFileSync(new URL('../../seed/buildings.geojson', import.meta.url), 'utf8'));
const feature = fc.features[0];
const b: BuildingCard = {
  ...feature.properties, id: 1, geometry: feature.geometry, center: [30.26, 59.94],
  source: 'base', name: feature.properties.name, year_source: 'generated', my_report_id: null,
  context: { metro_name: 'Нарвская', metro_dist_m: 600, transit_index: 71, social_500m: 25, commercial_density: 64, business_activity: 35 },
  accuracy: { level: 'low', docs_pending: 0, docs_accepted: 0 },
  zones: { source: 'Демо-разметка', checked_on: '2026-11-23', demo: true,
    items: [{ code: 'szz', title: 'Санитарно-защитная зона предприятия', effect: 'restriction', note: 'Проверить режим зоны.' }] },
};
const raw = JSON.parse(readFileSync(new URL('../../seed/demo_reports/dk-kirova.json', import.meta.url), 'utf8'));
const output = annotateStatic(b, raw as EngineOutput);
const fixture: Report = { id: 'report-test', kind: 'user', status: 'ready', accuracy_level: 'low', engine_version: 'mock-test',
  created_at: '2026-11-23T09:00:00Z', finished_at: '2026-11-23T09:00:00Z', refined: false, building: b, result: output, can_share: true };
const user = { id: 'owner', email: 'owner@example.test', type: 'individual', segment: 'owner', role: 'user', company_name: null, phone: null };

test('статические пояснения сохраняют числа и не подтверждают демо-зоны', () => {
  const source = structuredClone(raw) as EngineOutput;
  source.scenarios.forEach((s) => { delete s.feasibility; delete s.evidence; });
  const before = source.scenarios.map((s) => s.economics);
  const explained = annotateStatic(b, source);
  expect(explained.scenarios.map((s) => s.economics)).toEqual(before);
  expect(explained.scenarios.every((s) => s.feasibility?.status !== 'feasible')).toBeTruthy();
  expect(explained.tech_risks?.length).toBeGreaterThan(0);
  expect(explained.next_steps?.length).toBeGreaterThan(0);
  expect(explained.scenarios[0]?.evidence?.confirmed.join(' ')).not.toContain('Зоны');
  expect(explained.scenarios[0]?.evidence?.missing.join(' ')).toContain('демонстрационная');
});

test('паспорт, основания, риски и печать доступны гостю на телефоне', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/v1/shared/open-token')
      return route.fulfill({ json: { ...fixture, kind: 'shared' } });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'Не найдено' } } });
  });
  await page.goto('/shared/open-token');
  await expect(page.getByRole('heading', { name: b.address, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Поделиться отчётом' })).toHaveCount(0);
  await page.getByText('Паспорт здания: источники и даты', { exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Оценка по эпохе застройки района', exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Проверка реализуемости' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Следующие шаги' })).toBeVisible();
  await page.getByText('Паспорт здания: источники и даты', { exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(page.locator('details')).toHaveAttribute('open', '');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('details')).not.toHaveAttribute('open', '');
  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    const toggle = page.locator('summary');
    await toggle.screenshot({ path: testInfo.outputPath(`passport-${viewport.width}-closed.png`) });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('details')).toHaveAttribute('open', '');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await toggle.screenshot({ path: testInfo.outputPath(`passport-${viewport.width}-open.png`) });
    await page.locator('details').screenshot({ path: testInfo.outputPath(`passport-${viewport.width}-full.png`) });
    for (const section of ['constraints', 'technical', 'next']) {
      await page.locator(`#${section}`).screenshot({ path: testInfo.outputPath(`${section}-${viewport.width}.png`) });
    }
    await page.locator('#scenario-1').screenshot({ path: testInfo.outputPath(`scenario-${viewport.width}.png`) });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('details')).not.toHaveAttribute('open', '');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('report-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('details').evaluate((d) => { d.style.width = '360px'; d.open = true; });
  expect(await page.locator('details').evaluate((d) => d.scrollWidth <= d.clientWidth)).toBeTruthy();
  await page.locator('details').screenshot({ path: testInfo.outputPath('passport-narrow-panel.png') });
  await page.locator('details').evaluate((d) => { d.style.width = ''; d.open = false; });
  await page.screenshot({ path: testInfo.outputPath('report-desktop.png') });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.pdf({ path: testInfo.outputPath('report.pdf'), preferCSSPageSize: true, printBackground: true });
});

test('владелец создаёт и отзывает ссылку, гость получает отказ после отзыва', async ({ page, browser }, testInfo) => {
  let opened = false;
  const token = 'test-share-token-123456789';
  const sh = { token, shared_at: '2026-11-23T09:00:00Z' };
  const mock = async (context: BrowserContext) => {
    await context.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/auth/refresh')) return route.fulfill({ json: { access_token: 'test', user, access: null } });
      if (path === '/api/v1/me') return route.fulfill({ json: { user, access: null, notifications: [] } });
      if (path === '/api/v1/reports/report-test/share') {
        if (route.request().method() === 'DELETE') { opened = false; return route.fulfill({ status: 204 }); }
        opened = true;
        return route.fulfill({ json: sh });
      }
      if (path === '/api/v1/reports/report-test') return route.fulfill({ json: { ...fixture, share: opened ? sh : undefined } });
      if (path === `/api/v1/shared/${token}` && opened) return route.fulfill({ json: { ...fixture, kind: 'shared' } });
      return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'Владелец закрыл доступ к отчёту.' } } });
    });
  };
  await page.context().addCookies([{ name: 'soremo_session', value: '1', url: 'http://127.0.0.1:5183' }]);
  await mock(page.context());
  await page.goto('/reports/report-test');
  await page.getByRole('button', { name: 'Поделиться отчётом' }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').screenshot({ path: testInfo.outputPath(`share-${width}-closed.png`) });
  }
  await page.getByRole('button', { name: 'Создать ссылку' }).click();
  await expect(page.getByLabel('Ссылка на отчёт')).toHaveValue(`http://127.0.0.1:5183/shared/${token}`);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    expect(await page.getByRole('dialog').evaluate((d) => d.scrollWidth <= d.clientWidth)).toBeTruthy();
    await page.getByRole('dialog').screenshot({ path: testInfo.outputPath(`share-${width}-open.png`) });
  }
  const guest = await browser.newContext();
  try {
    await mock(guest);
    const viewer = await guest.newPage();
    await viewer.goto(`/shared/${token}`);
    await expect(viewer.getByRole('heading', { name: b.address, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть доступ', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Создать ссылку' })).toBeVisible();
    await viewer.reload();
    await expect(viewer.getByRole('heading', { name: 'Ссылка не действует' })).toBeVisible();
    await expect(viewer.getByRole('heading', { name: b.address, exact: true })).toHaveCount(0);
    for (const width of [390, 768, 1440]) {
      await viewer.setViewportSize({ width, height: 900 });
      expect(await viewer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      await viewer.screenshot({ path: testInfo.outputPath(`revoked-${width}.png`) });
    }
  } finally { await guest.close(); }
});

import { expect, test } from '@playwright/test';

// ТЗ 10.5: регистрация → пакет → объект → отчёт → PDF.
test('регистрация, пакет, моделирование, отчёт и PDF', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.ru`;

  // Регистрация
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill('password123');
  await page.getByText('Юрлицо', { exact: true }).click();
  await page.getByText('Инвестор', { exact: true }).click();
  await page.getByLabel(/Название компании/).fill('ООО «Нарвская застава»');
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();

  // Подтверждение email по ссылке из режима разработки
  await expect(page.getByRole('heading', { name: 'Проверьте почту' })).toBeVisible();
  await page.getByRole('link', { name: /verify\?token=/ }).click();
  await expect(page.getByRole('heading', { name: 'Кабинет' })).toBeVisible();

  // Пакет и мок-оплата
  await page.goto('/pricing');
  await page.getByText('5', { exact: true }).first().click();
  await expect(page.getByText('120 000 ₽').first()).toBeVisible();
  await page.getByRole('button', { name: 'Перейти к оплате' }).click();
  await page.getByLabel('Номер карты').fill('4242424242424242');
  await page.getByLabel('Срок действия').fill('1229');
  await page.getByLabel('CVC').fill('123');
  await page.getByLabel('Имя на карте').fill('ANNA K');
  await page.getByRole('button', { name: /Оплатить 120 000/ }).click();
  await expect(page.getByRole('heading', { name: 'Доступ открыт' })).toBeVisible();

  // Объект: поиск по адресу и карточка
  await page.getByRole('link', { name: 'К карте' }).click();
  await page.getByRole('combobox').fill('Цветочная 16');
  await page.getByRole('option', { name: /Цветочная ул., 16/ }).click();
  await expect(page.getByRole('heading', { name: 'Цветочная ул., 16' })).toBeVisible();
  await expect(page.getByText(/Спишется 1 объект/)).toBeVisible();

  // Моделирование: экран ожидания, затем отчёт
  await page.getByRole('button', { name: 'Смоделировать сценарии' }).click();
  await expect(page.getByRole('heading', { name: 'Моделируем сценарии' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Резюме' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Сравнение сценариев' })).toBeVisible();
  await expect(page.getByText('Черновик без документов')).toBeVisible();

  // PDF
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Скачать PDF' }).click();
  const file = await download;
  const path = await file.path();
  const fs = await import('node:fs');
  const head = fs.readFileSync(path!).subarray(0, 5).toString();
  expect(head).toBe('%PDF-');
  expect(fs.statSync(path!).size).toBeGreaterThan(30_000);

  // Отчёт в кабинете, лимит списан
  await page.goto('/account?tab=objects');
  await expect(page.getByRole('cell', { name: /Цветочная ул., 16/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Доступ' }).click();
  await expect(page.getByText('1 из 5')).toBeVisible();
});

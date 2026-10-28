import { expect, type Page } from '@playwright/test';

/** Регистрирует пользователя через UI и подтверждает email по dev-ссылке. */
export async function signUp(page: Page, segment = 'Собственник') {
  const email = `e2e-${Date.now()}-${Math.round(Math.random() * 1e4)}@example.ru`;
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill('password123');
  await page.getByText('Физлицо', { exact: true }).click();
  await page.getByText(segment, { exact: true }).click();
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await page.getByRole('link', { name: /verify\?token=/ }).click();
  await expect(page.getByRole('heading', { name: 'Кабинет' })).toBeVisible();
  return email;
}

export async function buyPackage(page: Page) {
  await page.goto('/pricing');
  await page.getByText('5', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Перейти к оплате' }).click();
  await page.getByLabel('Номер карты').fill('4242424242424242');
  await page.getByLabel('Срок действия').fill('1229');
  await page.getByLabel('CVC').fill('123');
  await page.getByLabel('Имя на карте').fill('E2E TEST');
  await page.getByRole('button', { name: /Оплатить/ }).click();
  await expect(page.getByRole('heading', { name: 'Доступ открыт' })).toBeVisible();
}

export async function asAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@soremo.local');
  await page.getByLabel('Пароль').fill('admin1234');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Модерация' })).toBeVisible();
}

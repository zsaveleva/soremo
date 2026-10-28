import { expect, test } from '@playwright/test';

// ТЗ 4.1: гость видит карту, карточку объекта и пример отчёта без регистрации.
test('гость открывает карточку и пример отчёта', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Сценарии реновации советских нежилых зданий Петербурга')).toBeVisible();
  await page.getByRole('button', { name: 'Как это работает' }).click();
  await expect(page.getByText(/0,5–3 млн ₽/)).toBeVisible();

  await page.getByRole('combobox').fill('дк кирова');
  await page.getByRole('option', { name: /Большой пр. В.О., 83/ }).click();
  await expect(page.getByRole('heading', { name: 'Большой пр. В.О., 83' })).toBeVisible();
  await expect(page).toHaveURL(/\/map\?b=\d+/);
  await page.getByRole('link', { name: 'Открыть пример отчёта' }).click();
  await expect(page.getByRole('heading', { name: 'Резюме' })).toBeVisible();
  await expect(page.getByText('Пример отчёта').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Деловой центр с конгресс-залом' })).toBeVisible();

  // Обычный объект: карточка открыта, отчёт — после регистрации
  await page.goto('/');
  await page.getByRole('button', { name: 'Списком' }).click();
  await page.getByRole('button', { name: /Цветочная ул., 16/ }).click();
  await expect(page.getByText('Для отчёта нужен доступ', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Зарегистрироваться' })).toBeVisible();
});

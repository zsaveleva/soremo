import { expect, test } from '@playwright/test';
import { asAdmin, buyPackage, signUp } from './helpers';

// ТЗ 4.4 и 4.5: документ и новый объект проходят модерацию и меняют продукт для пользователя.
test('техобследование повышает точность, новый объект появляется на карте', async ({ browser }) => {
  const user = await browser.newPage();
  await signUp(user, 'Собственник');
  await expect(user.getByText(/Загрузите техобследование, чтобы получить точный отчёт/)).toBeVisible();
  await buyPackage(user);

  // Моделирование без документов: случайное здание, по которому документов ещё нет
  const res = await user.request.get('/api/v1/buildings?bbox=29.42,59.63,30.76,60.25&zoom=14&has_docs=false&function=industrial');
  const all = (await res.json()).features.filter((f: { properties: { is_demo: boolean } }) => !f.properties.is_demo);
  const target = all[Math.floor(Math.random() * all.length)];
  const address: string = target.properties.address;
  await user.goto(`/map?b=${target.id}`);
  await expect(user.getByRole('heading', { name: address })).toBeVisible();
  await user.getByRole('button', { name: 'Смоделировать сценарии' }).click();
  await expect(user.getByRole('heading', { name: 'Резюме' })).toBeVisible({ timeout: 30_000 });
  await expect(user.getByText('Черновик без документов')).toBeVisible();

  // Загрузка документа
  await user.getByRole('link', { name: 'Загрузить техобследование' }).click();
  await user.locator('input[type=file]').setInputFiles('e2e/fixtures/techzaklyuchenie.pdf');
  await user.getByLabel('Тип документа').selectOption('survey');
  await user.getByLabel('Дата документа').fill('2024-03-14');
  await user.getByRole('button', { name: 'Отправить на проверку' }).click();
  await expect(user.getByText('Документ отправлен на проверку')).toBeVisible();
  await expect(user.getByRole('cell', { name: /На проверке/ })).toBeVisible();

  // Заявка на объект
  await user.goto('/objects/new');
  await user.getByLabel('Адрес').fill('Кожевенная линия, 40');
  await user.locator('[aria-label^="Карта: нажмите"]').click({ position: { x: 300, y: 300 } });
  await user.getByLabel('Год постройки').fill('1968');
  await user.getByLabel('Общая площадь').fill('5400');
  await user.getByLabel('Этажность').fill('3');
  await user.getByLabel('Исходное назначение').selectOption('industrial');
  await user.getByRole('button', { name: 'Отправить на проверку' }).click();
  await expect(user.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();

  // Модерация
  const admin = await browser.newPage();
  await asAdmin(admin);
  await admin.getByRole('row', { name: new RegExp(address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).getByRole('button', { name: 'techzaklyuchenie.pdf' }).first().click();
  await expect(admin.getByTitle(/Превью/)).toBeVisible();
  await admin.getByRole('button', { name: 'Принять' }).click();
  await expect(admin.getByText('Принято, пользователь получил уведомление')).toBeVisible();
  await admin.getByRole('tab', { name: 'Заявки на объекты' }).click();
  await admin.getByRole('button', { name: 'Кожевенная линия, 40' }).first().click();
  await admin.getByRole('button', { name: 'Принять' }).click();
  await expect(admin.getByText('Принято, пользователь получил уведомление')).toBeVisible();

  // Пользователь видит результат: уведомления, точность, бесплатный пересчёт
  await user.goto('/account?tab=objects');
  await expect(user.getByText(`Техническое обследование по адресу ${address} принято`, { exact: false })).toBeVisible();
  await expect(user.getByText(/Объект Кожевенная линия, 40 добавлен в базу/)).toBeVisible();
  await user.getByRole('cell', { name: address }).first().click();
  await user.getByRole('button', { name: 'Пересчитать отчёт' }).click();
  await expect(user.getByRole('heading', { name: 'Резюме' })).toBeVisible({ timeout: 30_000 });
  await expect(user.getByText('Уточнён по документам')).toBeVisible();
  await expect(user.getByRole('meter', { name: 'Точность отчёта' })).toHaveAttribute('aria-valuenow', '85');
  await user.goto('/account?tab=access');
  await expect(user.getByText('1 из 5')).toBeVisible();
});

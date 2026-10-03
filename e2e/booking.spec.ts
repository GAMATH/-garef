import { expect, test, type Page } from '@playwright/test';

const SALON = '/salon/le-barbier-de-poto-poto-brazzaville';

/** Counts user taps (clicks) to verify the « < 8 taps from the salon page » criterion. */
async function countTaps(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __taps: number }).__taps = 0;
    document.addEventListener('click', (e) => { if (e.isTrusted) (window as unknown as { __taps: number }).__taps++; }, true);
  });
  return () => page.evaluate(() => (window as unknown as { __taps: number }).__taps);
}

async function pickFirstSlot(page: Page) {
  const slot = page.locator('section[aria-label] button[aria-pressed]').first();
  await expect(slot).toBeVisible();
  await slot.click();
}

test('a new visitor books on mobile without an account, in < 60 s and < 8 taps', async ({ page }) => {
  await page.goto(SALON);
  await expect(page.getByRole('heading', { name: 'Le Barbier de Poto-Poto' })).toBeVisible();
  const taps = await countTaps(page);
  const started = Date.now();

  await page.getByRole('button', { name: /Ajouter Coupe homme/ }).click(); // 1
  await page.getByRole('button', { name: 'Réserver' }).click(); // 2
  await page.getByRole('button', { name: /Peu importe/ }).click(); // 3 (auto-advance)
  await pickFirstSlot(page); // 4 (auto-advance)
  await page.getByLabel('Prénom').fill('Awa'); // 5 (focus)
  await page.getByLabel('Téléphone').fill('061112233'); // 6 (focus)
  await page.getByRole('button', { name: 'Continuer' }).click(); // 7
  await expect(page.getByText('Créneau réservé pour vous')).toBeVisible();
  await page.getByRole('button', { name: 'Réserver' }).click(); // 8 — « Payer sur place » is the default

  await expect(page.getByRole('heading', { name: 'C’est réservé.' })).toBeVisible();
  await expect(page.getByText(/^KZ-[A-Z0-9]{5}$/)).toBeVisible();
  const n = await taps();
  expect(n).toBeLessThanOrEqual(8);
  expect(Date.now() - started).toBeLessThan(60_000);
});

test('a declined Mobile Money payment releases the slot and returns to time selection', async ({ page }) => {
  await page.goto('/salon/maison-nzinga-brazzaville');
  await page.getByRole('button', { name: /Ajouter Tresses collées/ }).click();
  await page.getByRole('button', { name: 'Réserver' }).click();
  await page.getByRole('button', { name: /Peu importe/ }).click();
  await pickFirstSlot(page);
  await page.getByLabel('Prénom').fill('Bénie');
  await page.getByLabel('Téléphone').fill('061234000');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByText('Tout payer maintenant').click();
  await page.getByLabel(/Numéro/).fill('060000000'); // ends with 0000 → declined by the mock provider
  await page.getByRole('button', { name: /^Payer/ }).click();
  await expect(page.getByText('Validez le paiement sur votre téléphone')).toBeVisible();
  await expect(page.getByText(/Paiement refusé/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Date et heure' })).toBeVisible();
});

test('a client booking appears in the salon agenda in < 2 s without reload', async ({ page, context }) => {
  // Tab 1: the salon manager's agenda.
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Email' }).click();
  await page.getByLabel('Email').fill('gerant@kuzuri.demo');
  await page.getByLabel('Mot de passe').fill('kuzuri2026');
  await page.getByRole('button', { name: 'Se connecter' }).last().click();
  await expect(page.getByRole('heading', { name: 'Aujourd’hui' })).toBeVisible();
  await page.goto('/business/bookings');
  await expect(page.getByText(/réservations?$/).first()).toBeVisible();

  // Tab 2: a client books.
  const client = await context.newPage();
  await client.goto('/salon/maison-nzinga-brazzaville');
  await client.getByRole('button', { name: /Ajouter Entretien locks/ }).click();
  await client.getByRole('button', { name: 'Réserver' }).click();
  await client.getByRole('button', { name: /Peu importe/ }).click();
  await pickFirstSlot(client);
  // Signed in (shared session) → contact step is skipped, straight to payment.
  await expect(client.getByText('Créneau réservé pour vous')).toBeVisible();
  await client.getByRole('button', { name: 'Réserver' }).click();
  await expect(client.getByRole('heading', { name: 'C’est réservé.' })).toBeVisible();
  const confirmedAt = Date.now();

  // Back in tab 1: the toast and the row show up without reloading.
  await expect(page.getByText(/Nouvelle réservation/)).toBeVisible({ timeout: 2_000 });
  expect(Date.now() - confirmedAt).toBeLessThan(2_000);
});

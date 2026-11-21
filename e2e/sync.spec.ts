import { test, expect, devices, type Page, type Browser } from '@playwright/test';

const WORKER = 'http://localhost:8787';
const UTC = (iso: string) => new Date(iso);

async function phone(browser: Browser, time: string) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  await ctx.addInitScript((url) => localStorage.setItem('a2z-sync-url', url), WORKER); // local test copy of the cloud
  const page = await ctx.newPage();
  await page.clock.setFixedTime(UTC(time));
  return { ctx, page };
}
async function ready(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.getByTestId('product-row').first()).toBeVisible();
}
async function addStore(page: Page, name: string) {
  await page.click('[data-testid=nav-stores]');
  await page.getByRole('button', { name: 'Add New Store' }).click();
  await page.fill('input[name=storeName]', name);
  await page.fill('textarea[name=storeAddress]', `${name} address, FL`);
  await page.getByRole('button', { name: 'Save Store' }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}
async function addCases(page: Page, q: string, label: string, n: number) {
  await page.click('[data-testid=nav-products]');
  await page.fill('input[aria-label="Search products"]', q);
  for (let i = 0; i < n; i++) await page.getByRole('button', { name: `Increase ${label}`, exact: true }).first().click();
}
async function finalize(page: Page) {
  await page.click('[data-testid=nav-cart]');
  await page.getByRole('button', { name: 'Finalize Order' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Finalize' }).click();
  await expect(page).toHaveURL(/#\/orders\/o_/);
}
async function syncAndWait(page: Page) {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('sync-status')).toContainText('Last synced');
  await expect(page.getByTestId('sync-status')).not.toContainText('waiting to upload', { timeout: 20_000 });
  await expect(page.getByTestId('sync-status')).not.toContainText('Syncing');
}

test('cloud sync: first phone uploads, second phone pairs, changes sync both ways, the cloud finalizes Friday’s report', async ({ browser, request }) => {
  // ---------- phone A: some data, then turn on cloud sync
  const A = await phone(browser, '2026-11-23T14:00:00Z'); // Mon Nov 23, 9 AM New York (week 1)
  await ready(A.page);
  await addStore(A.page, 'Cloud Store');
  await addCases(A.page, 'coke 20oz', 'COKE 20OZ 24CT', 2); // 2 × 32.99
  await finalize(A.page);
  await addCases(A.page, 'sprite 20oz', 'SPRITE 20OZ 24CT', 1); // stays in the cart (draft)
  await A.page.goto('/#/settings');
  await expect(A.page.getByTestId('cloud-sync')).toContainText('Off');
  await A.page.getByRole('button', { name: 'Turn on cloud sync' }).click();
  await expect(A.page.getByTestId('cloud-sync')).toContainText('On');
  await expect(A.page.getByTestId('sync-status')).toContainText('Last synced', { timeout: 60_000 });
  await expect(A.page.getByTestId('sync-status')).not.toContainText('waiting to upload', { timeout: 60_000 });
  const key = await A.page.evaluate(() => localStorage.getItem('a2z-sync-key'));
  expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // ---------- security: nothing without the key; the cloud cannot be claimed a second time
  expect((await request.post(`${WORKER}/sync`, { data: { since: 0, device: 'x', changes: [] } })).status()).toBe(401);
  expect((await request.post(`${WORKER}/sync`, { headers: { Authorization: 'Bearer ' + 'x'.repeat(43) }, data: { since: 0, device: 'x', changes: [] } })).status()).toBe(401);
  expect((await request.post(`${WORKER}/claim`, { data: { key: 'y'.repeat(43) } })).status()).toBe(409);

  // ---------- phone B: pair with the link → gets everything
  const B = await phone(browser, '2026-11-24T15:00:00Z');
  await ready(B.page);
  await B.page.goto(`/#/pair/${key}`);
  await B.page.getByRole('button', { name: 'Connect this phone' }).click();
  await expect(B.page.getByText('This phone is connected to your cloud data')).toBeVisible({ timeout: 60_000 });
  await B.page.goto('/#/orders');
  await expect(B.page.getByText('Cloud Store').first()).toBeVisible();
  await expect(B.page.getByText('$65.98').first()).toBeVisible();
  await B.page.click('[data-testid=nav-stores]');
  await B.page.getByRole('button', { name: /Select & start order|Continue order/ }).first().click();
  await B.page.click('[data-testid=nav-cart]');
  await expect(B.page.getByTestId('cart-row')).toHaveCount(1); // Sprite draft from phone A
  await expect(B.page.getByTestId('cart-row')).toContainText('SPRITE');
  // the first order of the new store was already used on phone A → no label on phone B
  await expect(B.page.getByTestId('new-store-banner')).toHaveCount(0);
  // the products are not duplicated
  await B.page.click('[data-testid=nav-products]');
  await B.page.fill('input[aria-label="Search products"]', 'coke 20oz 24ct');
  await expect(B.page.getByRole('button', { name: 'Increase COKE 20OZ 24CT', exact: true })).toHaveCount(1);

  // ---------- phone B takes an order → phone A sees it
  await addStore(B.page, 'Phone B Store');
  await addCases(B.page, 'monster green', 'MONSTER GREEN 16OZ 24CT', 3); // 3 × 38.50
  await finalize(B.page);
  await syncAndWait(B.page);
  await syncAndWait(A.page);
  await A.page.goto('/#/orders');
  await expect(A.page.getByText('Phone B Store').first()).toBeVisible();

  // ---------- Friday 11:59:59 PM passes: the CLOUD finalizes week 1 (no phone involved)
  const run = await request.post(`${WORKER}/run-reports`, { headers: { Authorization: `Bearer ${key}` }, data: { now: UTC('2026-11-28T05:02:00Z').getTime() } });
  expect(await run.json()).toEqual({ created: ['WR-2026-11-21'] });
  const again = await request.post(`${WORKER}/run-reports`, { headers: { Authorization: `Bearer ${key}` }, data: { now: UTC('2026-11-28T06:02:00Z').getTime() } });
  expect(await again.json()).toEqual({ created: [] }); // never twice

  // phone A opens on Saturday and gets the cloud's report (orders from both phones)
  await A.page.clock.setFixedTime(UTC('2026-11-28T14:00:00Z'));
  await A.page.goto('/#/reports');
  await A.page.reload();
  const hist = A.page.getByTestId('report-history');
  await expect(hist).toContainText('Week 1', { timeout: 30_000 });
  await expect(hist).toContainText('$181.48'); // 65.98 + 115.50
  await expect(hist).toContainText('$1.81'); // 1% (1.8148 → 1.81)
  await hist.getByRole('link', { name: 'Week 1' }).click();
  await expect(A.page.getByText('automatically')).toBeVisible();
  await expect(A.page.getByTestId('metric-stores-that-placed-orders')).toHaveText('2');
  await expect(A.page.getByTestId('metric-new-stores-added')).toHaveText('2');

  // phone B sees exactly the same finalized report
  await B.page.clock.setFixedTime(UTC('2026-11-28T15:00:00Z'));
  await B.page.goto('/#/reports');
  await B.page.reload();
  await expect(B.page.getByTestId('report-history')).toContainText('$181.48', { timeout: 30_000 });

  await A.ctx.close();
  await B.ctx.close();
});

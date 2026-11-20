import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRICE_PDF = path.join(__dirname, '../tests/fixtures/A2Z_Beverages_Price_Deals_A4_2.pdf');
const OUT = path.join(__dirname, '../test-results/e2e-artifacts');
fs.mkdirSync(OUT, { recursive: true });

async function pdfText(file: string) {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push((tc.items as { str: string }[]).map((t) => t.str).join(' '));
  }
  return pages;
}

async function addStore(page: Page, name: string, address = '1 Main St', phone = '', manager = '') {
  await page.click('[data-testid=nav-stores]');
  await page.getByRole('button', { name: 'Add New Store' }).click();
  await page.fill('input[name=storeName]', name);
  await page.fill('textarea[name=storeAddress]', address);
  if (phone) await page.fill('input[name=storePhone]', phone);
  if (manager) await page.fill('input[name=storeManager]', manager);
  await page.getByRole('button', { name: 'Save Store' }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}
async function selectStore(page: Page, name: string) {
  await page.click('[data-testid=nav-products]');
  await page.click('[data-testid=store-selector]');
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByTestId('store-selector')).toContainText(name);
}
const inc = (page: Page, label: string) => page.getByRole('button', { name: `Increase ${label}`, exact: true }).first();
const dec = (page: Page, label: string) => page.getByRole('button', { name: `Decrease ${label}`, exact: true }).first();
const qty = (page: Page, label: string) => page.getByRole('button', { name: `Quantity of ${label}`, exact: true }).first();
async function searchFor(page: Page, q: string) {
  await page.click('[data-testid=nav-products]');
  await page.fill('input[aria-label="Search products"]', q);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('product-row').first()).toBeVisible();
});

test('@smoke loads the real A2Z price sheet products with case prices', async ({ page }) => {
  await expect(page.getByText('131 products')).toBeVisible();
  await expect(page.getByText('A2Z Beverage Distributors')).toBeVisible();
  const first = page.getByTestId('product-row').first();
  await expect(first).toContainText('ZEPHYRHILLS');
  await expect(first).toContainText('8OZ / 48CT');
  await expect(first).toContainText('$8.49');
  await page.screenshot({ path: `${OUT}/${test.info().project.name}-products.png` });
});

test('QA 1-9: +/- quantities, auto cart add/remove, sync, totals', async ({ page }) => {
  await addStore(page, 'ABC Convenience Store', '123 Main St, Fort Lauderdale, FL', '(954) 555-0101', 'Maria');
  await searchFor(page, 'water');
  const evian = 'EVIAN WATER 500ML / 24CT';
  for (let i = 0; i < 3; i++) await inc(page, evian).click();
  await expect(qty(page, evian)).toHaveText('3'); // QA1
  await expect(page.getByTestId('cart-badge')).toHaveText('3'); // QA4 (appears in cart)
  await dec(page, evian).click();
  await expect(qty(page, evian)).toHaveText('2'); // QA2
  await dec(page, evian).click();
  await dec(page, evian).click();
  await expect(qty(page, evian)).toHaveText('0');
  await expect(dec(page, evian)).toBeDisabled(); // QA3: can't go negative
  await expect(page.getByTestId('cart-badge')).toHaveCount(0); // QA5: gone from cart
  for (let i = 0; i < 3; i++) await inc(page, evian).click();
  await searchFor(page, 'red bull 12');
  const rb = 'RED BULL 12OZ / 24CT';
  await inc(page, rb).click();
  await inc(page, rb).click();
  // cart
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByTestId('cart-row')).toHaveCount(2);
  await expect(page.getByTestId('total-products')).toHaveText('2'); // QA7
  await expect(page.getByTestId('total-cases')).toHaveText('5'); // QA8
  await expect(page.getByTestId('total-value')).toHaveText('$178.95'); // QA9: 3×22.99 + 2×54.99
  // change in cart -> products screen reflects it (QA6)
  await inc(page, evian).click();
  await inc(page, evian).click();
  await expect(qty(page, evian)).toHaveText('5');
  await expect(page.getByTestId('total-value')).toHaveText('$224.93');
  await searchFor(page, 'evian 500');
  await expect(qty(page, evian)).toHaveText('5');
  // remove from cart with the trash button
  await page.click('[data-testid=nav-cart]');
  await page.getByRole('button', { name: `Remove ${rb}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('cart-row')).toHaveCount(1);
  await expect(page.getByTestId('total-cases')).toHaveText('5');
});

test('rapid tapping is counted exactly, with no duplicate cart lines', async ({ page }) => {
  await addStore(page, 'Fast Store');
  await searchFor(page, 'monster 16');
  const m = 'MONSTER 16OZ / 24CT';
  const btn = inc(page, m);
  for (let i = 0; i < 25; i++) await btn.click({ delay: 0 });
  await expect(qty(page, m)).toHaveText('25');
  await page.reload();
  await searchFor(page, 'monster 16');
  await expect(qty(page, m)).toHaveText('25');
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByTestId('cart-row')).toHaveCount(1);
});

test('QA 10-11, 17: independent drafts per store, persisted after reload; similar products stay separate', async ({ page }) => {
  await addStore(page, 'Store One', '1 First Ave', '305-111-1111', 'Ann');
  await addStore(page, 'Store Two', '2 Second Ave');
  await selectStore(page, 'Store One');
  await searchFor(page, 'pellegrino');
  await inc(page, 'SAN PELLEGRINO 750ML / 12CT (GLASS)').click();
  await inc(page, 'SAN PELLEGRINO 1L / 12CT (PLASTIC)').click();
  await inc(page, 'SAN PELLEGRINO 1L / 12CT (PLASTIC)').click();
  await selectStore(page, 'Store Two');
  await expect(page.getByTestId('cart-badge')).toHaveCount(0);
  await searchFor(page, 'gatorade 28');
  await inc(page, 'GATORADE 28OZ / 15CT').click();
  await page.reload();
  await expect(page.getByTestId('store-selector')).toContainText('Store Two');
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByTestId('cart-row')).toHaveCount(1);
  await expect(page.getByTestId('total-value')).toHaveText('$29.99');
  await selectStore(page, 'Store One');
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByTestId('cart-row')).toHaveCount(2); // two separate Pellegrino variations
  await expect(page.getByTestId('total-cases')).toHaveText('3');
  await expect(page.getByTestId('total-value')).toHaveText('$88.97'); // 28.99 + 2×29.99
  await page.click('[data-testid=nav-stores]');
  await expect(page.getByText('305-111-1111')).toBeVisible(); // QA11
  await expect(page.getByText('Ann ·')).toBeVisible();
});

test('QA 14-16: order PDF (no prices) and detailed PDF, multi-page with repeated headers', async ({ page }) => {
  await page.click('[data-testid=nav-settings]');
  await page.fill('input[name=repPhone]', '(786) 555-0199');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await addStore(page, "Joe's Market & Deli", '77 Ocean Blvd, Miami, FL 33139', '(305) 555-0123', 'Joe Smith');
  // add 60 different products → must span multiple pages
  await page.click('[data-testid=nav-products]');
  const incs = page.getByRole('button', { name: /^Increase / });
  for (let i = 0; i < 60; i++) {
    await incs.nth(i).click();
    if (i % 7 === 0) await incs.nth(i).click();
  }
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByTestId('total-products')).toHaveText('60');
  await expect(page.getByTestId('total-cases')).toHaveText('69');
  const value = await page.getByTestId('total-value').innerText();

  const [d1] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Order PDF' }).click()]);
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  expect(d1.suggestedFilename()).toBe(`Order_Joe_s_Market_Deli_${ymd}.pdf`);
  const f1 = `${OUT}/${d1.suggestedFilename()}`;
  await d1.saveAs(f1);
  const p1 = await pdfText(f1);
  expect(p1.length).toBeGreaterThan(1); // multi-page
  const all1 = p1.join('\n');
  for (const s of ["Joe's Market & Deli", '77 Ocean Blvd, Miami, FL 33139', '(305) 555-0123', 'Joe Smith', 'Vishwak', '(786) 555-0199', 'A2Z Beverage Distributors', 'Total Products:', 'Total Cases:', '69', 'ZEPHYRHILLS 8OZ / 48CT'])
    expect(all1).toContain(s);
  for (const pg of p1) expect(pg).toContain('Quantity (Cases)'); // header repeated on each page
  expect(all1).not.toMatch(/\$\d/); // NO prices anywhere in the distributor PDF
  expect(all1).not.toContain('Order Value');

  const [d2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Detailed Order PDF' }).click()]);
  expect(d2.suggestedFilename()).toBe(`Order_Detailed_Joe_s_Market_Deli_${ymd}.pdf`);
  const f2 = `${OUT}/${d2.suggestedFilename()}`;
  await d2.saveAs(f2);
  const p2 = await pdfText(f2);
  const all2 = p2.join('\n');
  expect(p2.length).toBeGreaterThan(1);
  for (const pg of p2) expect(pg).toContain('Price/Case');
  expect(all2).toContain('Total Order Value:');
  expect(all2).toContain(value); // same value as the cart
  expect(all2).toContain('$8.49');
});

test('QA 18: completed orders keep their prices after a price change; reopen and re-download', async ({ page }) => {
  await addStore(page, 'History Store');
  await searchFor(page, 'celsius');
  await inc(page, 'CELSIUS 12OZ / 12CT').click();
  await inc(page, 'CELSIUS 12OZ / 12CT').click();
  await page.click('[data-testid=nav-cart]');
  await page.getByRole('button', { name: 'Finalize Order' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Finalize' }).click();
  await expect(page).toHaveURL(/#\/orders\/o_/);
  await expect(page.getByText('$40.98').first()).toBeVisible(); // order detail
  // change the price
  await page.goto('/#/settings/products');
  await page.getByRole('button', { name: /Price sheet lines/ }).click();
  await page.fill('input[aria-label="Search products and prices"]', 'celsius');
  await page.getByRole('button', { name: /CELSIUS 12OZ \/ 12CT/ }).click();
  await page.getByRole('alertdialog').locator('input').fill('25.00');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save' }).click();
  await searchFor(page, 'celsius');
  await expect(page.getByTestId('product-row').first()).toContainText('$25.00');
  // history unchanged
  await page.click('[data-testid=nav-orders]');
  await expect(page.getByText('History Store')).toBeVisible();
  await expect(page.getByText('$40.98')).toBeVisible();
  await page.getByText('History Store').click();
  await expect(page.getByText('$20.49').first()).toBeVisible();
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Detailed Order PDF' }).click()]);
  const f = `${OUT}/history-${d.suggestedFilename()}`;
  await d.saveAs(f);
  const t = (await pdfText(f)).join(' ');
  expect(t).toContain('$20.49');
  expect(t).toContain('$40.98');
  expect(t).not.toContain('$25.00');
  // copy as new draft → current price
  await page.getByRole('button', { name: 'Copy to new draft' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByTestId('total-value')).toHaveText('$50.00');
});

test('QA 12-13: catalog import, auto/needs-review/unmatched, manual confirm persists after reload, unpriced warning', async ({ page }) => {
  const csv = [
    'department,category,brand,name,variation,units_per_case,sku',
    'WATER,Bottled Water,Evian,Natural Spring Water,500ML 24PK,24,',
    'WATER,Bottled Water,Saratoga,Spring Water,28OZ 12PK,12,',
    'SNACKS,Chips,Lays,Classic Potato Chips,1.5OZ 64CT,64,LAY-001',
  ].join('\n');
  await page.goto('/#/settings/import-catalog');
  await page.setInputFiles('[data-testid=catalog-file]', { name: 'catalog.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('3 products found')).toBeVisible();
  await page.getByRole('button', { name: 'Import 3 products' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('button', { name: /Needs review \(1\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Unmatched \(1\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Matched \(1\)/ })).toBeVisible();
  // Saratoga is ambiguous (STILL vs SPARKLING 28OZ) — pick the right one manually
  await page.getByRole('button', { name: 'Choose Different Product' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /SARATOGA WATER STILL 28OZ \/ 12CT/ }).first().click();
  await expect(page.getByRole('button', { name: /Matched \(2\)/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Matched \(2\)/ })).toBeVisible(); // QA12 persisted
  // unpriced product is clearly marked and warned about
  await addStore(page, 'Snack Store');
  await searchFor(page, 'lays');
  await expect(page.getByTestId('product-row').first()).toContainText('Price not available');
  await inc(page, 'Lays Classic Potato Chips 1.5OZ 64CT').click();
  await searchFor(page, 'saratoga spring');
  await expect(page.getByTestId('product-row').first()).toContainText('$24.49');
  await inc(page, 'Saratoga Spring Water 28OZ 12PK').click();
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByRole('alert')).toContainText('1 product(s) have no price');
  await expect(page.getByTestId('total-value')).toHaveText('$24.49');
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Detailed Order PDF' }).click()]);
  const f = `${OUT}/unpriced-${d.suggestedFilename()}`;
  await d.saveAs(f);
  const t = (await pdfText(f)).join(' ');
  expect(t).toContain('N/A');
  expect(t).toContain('NOT included in the Total Order Value');
});

test('price sheet PDF upload: extracts all 131 lines and shows them as unchanged', async ({ page }) => {
  await page.goto('/#/settings/import-prices');
  await page.setInputFiles('[data-testid=price-file]', PRICE_PDF);
  await expect(page.getByText('131 lines found')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('131 unchanged')).toBeVisible();
  await expect(page.getByText('0 new')).toBeVisible();
  await expect(page.getByText('0 price changes')).toBeVisible();
});

test('QA 19: stays responsive with 1,200+ products (CPU throttled 4x like a budget phone)', async ({ page }) => {
  const lines = ['department,category,brand,name,variation,units_per_case,sku'];
  const brands = ['Lays', 'Doritos', 'Cheetos', 'Snickers', 'Twix', 'Skittles', 'Pringles', 'Oreo', 'Ritz', 'Tums'];
  for (let i = 0; i < 1200; i++) lines.push(`SNACKS,Cat ${i % 9},${brands[i % 10]},Item ${i},${(i % 20) + 1}OZ ${[12, 24, 48][i % 3]}CT,${[12, 24, 48][i % 3]},SKU${100000 + i}`);
  await page.goto('/#/settings/import-catalog');
  await page.setInputFiles('[data-testid=catalog-file]', { name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')) });
  await page.getByRole('button', { name: 'Import 1200 products' }).click();
  const tImport = Date.now();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click();
  await expect(page).toHaveURL(/#\/settings\/review/, { timeout: 60_000 });
  console.log(`PERF import + match 1200 catalog products: ${Date.now() - tImport} ms`);
  await page.click('[data-testid=nav-products]');
  await expect(page.getByText('1331 products')).toBeVisible();
  await addStore(page, 'Perf Store');
  await page.click('[data-testid=nav-products]');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // search latency
  let t0 = Date.now();
  await page.fill('input[aria-label="Search products"]', 'doritos item 1');
  await expect(page.getByTestId('product-row').first()).toContainText('Doritos');
  const searchMs = Date.now() - t0;
  // tap latency
  await page.fill('input[aria-label="Search products"]', '');
  const b = page.getByRole('button', { name: /^Increase / }).first();
  t0 = Date.now();
  for (let i = 0; i < 10; i++) await b.click();
  await expect(page.getByTestId('qty').first()).toHaveText('10');
  const tapMs = (Date.now() - t0) / 10;
  // scroll to the end of the list (incremental rendering)
  t0 = Date.now();
  for (let i = 0; i < 25; i++) await page.evaluate(() => document.querySelector('main')!.scrollBy(0, 4000));
  const scrollMs = Date.now() - t0;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(`PERF (4x CPU throttle): search ${searchMs} ms, per tap ${tapMs.toFixed(0)} ms (incl. test-driver overhead), 25 scroll steps ${scrollMs} ms`);
  expect(searchMs).toBeLessThan(1500);
  expect(tapMs).toBeLessThan(400);
});

test('QA 20: backup and restore round-trip without data loss', async ({ page, browser }) => {
  await addStore(page, 'Backup Store', '9 Backup Rd', '111', 'Bob');
  await searchFor(page, 'bang');
  await inc(page, 'BANG 16OZ / 12CT').click();
  await inc(page, 'BANG 16OZ / 12CT').click();
  await page.goto('/#/settings/backup');
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup file' }).click()]);
  const file = `${OUT}/${d.suggestedFilename()}`;
  await d.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(json.app).toBe('a2z-order-app');
  expect(json.tables.stores.length).toBe(1);

  // a brand-new phone (empty browser profile)
  const ctx2 = await browser.newContext({ acceptDownloads: true });
  const p2 = await ctx2.newPage();
  await p2.goto('/#/settings/backup');
  await p2.setInputFiles('[data-testid=restore-file]', file);
  await p2.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click();
  await expect(p2.getByText('Backup restored')).toBeVisible();
  await p2.goto('/#/cart');
  await expect(p2.getByTestId('store-selector')).toContainText('Backup Store');
  await expect(p2.getByTestId('total-cases')).toHaveText('2');
  await expect(p2.getByTestId('total-value')).toHaveText('$49.98');
  // re-export from the new phone is identical
  await p2.goto('/#/settings/backup');
  const [d2] = await Promise.all([p2.waitForEvent('download'), p2.getByRole('button', { name: 'Download backup file' }).click()]);
  const json2 = JSON.parse(fs.readFileSync(await d2.path(), 'utf8'));
  expect(JSON.stringify(json2.tables)).toBe(JSON.stringify(json.tables));
  await ctx2.close();
});

test('@smoke works offline after the first visit (installed PWA)', async ({ page, context }) => {
  await page.waitForFunction(async () => !!(await navigator.serviceWorker?.ready)?.active, null, { timeout: 30_000 });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('131 products')).toBeVisible();
  await addStore(page, 'Offline Store');
  await searchFor(page, 'arizona');
  await inc(page, 'ARIZONA 20OZ / 24CT').click();
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByTestId('total-value')).toHaveText('$18.49');
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Order PDF' }).click()]);
  expect(d.suggestedFilename()).toMatch(/^Order_Offline_Store_\d{4}-\d{2}-\d{2}\.pdf$/);
  await context.setOffline(false);
});

import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRICE_PDF = path.join(__dirname, '../tests/fixtures/A2Z_Beverages_Price_Deals_A4_2.pdf');
const OUT = path.join(__dirname, '../test-results/e2e-artifacts');
fs.mkdirSync(OUT, { recursive: true });
const REP_PHONE = '+1 561-552-6556';

async function pdfText(file: string) {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push((tc.items as { str: string }[]).map((t) => t.str).join(' '));
  }
  return pages;
}
async function download(page: Page, button: string | RegExp, prefix = '') {
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).first().click()]);
  const file = `${OUT}/${prefix}${d.suggestedFilename()}`;
  await d.saveAs(file);
  return { name: d.suggestedFilename(), file, text: (await pdfText(file)).join('\n'), pages: await pdfText(file) };
}

async function addStore(page: Page, name: string, address = '1 Main St', opts: { phone?: string; manager?: string; isNew?: boolean } = {}) {
  await page.click('[data-testid=nav-stores]');
  await page.getByRole('button', { name: 'Add New Store' }).click();
  await page.fill('input[name=storeName]', name);
  await page.fill('textarea[name=storeAddress]', address);
  if (opts.phone) await page.fill('input[name=storePhone]', opts.phone);
  if (opts.manager) await page.fill('input[name=storeManager]', opts.manager);
  const box = page.getByLabel('Mark as New Store');
  await expect(box).toBeChecked(); // on by default for a new store
  if (opts.isNew === false) await box.uncheck();
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
async function addCases(page: Page, q: string, label: string, n: number) {
  await searchFor(page, q);
  for (let i = 0; i < n; i++) await inc(page, label).click();
  await expect(qty(page, label)).toHaveText(String(n));
}
async function finalize(page: Page) {
  await page.click('[data-testid=nav-cart]');
  await page.getByRole('button', { name: 'Finalize Order' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Finalize' }).click();
  await expect(page).toHaveURL(/#\/orders\/o_/);
}

test.beforeEach(async ({ page }, info) => {
  if (info.title.includes('weekly report')) return; // that test sets its own clock first
  await page.goto('/');
  await expect(page.getByTestId('product-row').first()).toBeVisible();
});

test('@smoke loads the A2Z catalog with case prices from the price sheet', async ({ page }) => {
  await expect(page.getByText('A2Z Beverage Distributors')).toBeVisible();
  await expect(page.getByTestId('data-notice')).toContainText('406 of 542 catalog products are priced; 67 suggestions below 90% wait for your review');
  await searchFor(page, 'zephyrhills 8oz');
  const row = page.getByTestId('product-row').first();
  await expect(row).toContainText('ZEPHYRHILLS');
  await expect(row).toContainText('8OZ 48CT');
  await expect(row).toContainText('$8.49');
  await searchFor(page, '');
  await page.screenshot({ path: `${OUT}/${test.info().project.name}-products.png` });
});

test('QA 1-9: +/- quantities, auto cart add/remove, sync, totals', async ({ page }) => {
  await addStore(page, 'ABC Convenience Store', '123 Main St, Fort Lauderdale, FL', { phone: '(954) 555-0101', manager: 'Maria' });
  await searchFor(page, 'evian');
  const evian = 'EVIAN WATER 0.5L 24CT';
  for (let i = 0; i < 3; i++) await inc(page, evian).click();
  await expect(qty(page, evian)).toHaveText('3');
  await expect(page.getByTestId('cart-badge')).toHaveText('3');
  await dec(page, evian).click();
  await expect(qty(page, evian)).toHaveText('2');
  await dec(page, evian).click();
  await dec(page, evian).click();
  await expect(qty(page, evian)).toHaveText('0');
  await expect(dec(page, evian)).toBeDisabled(); // never negative
  await expect(page.getByTestId('cart-badge')).toHaveCount(0);
  for (let i = 0; i < 3; i++) await inc(page, evian).click();
  const rb = 'RED BULL COCONUT 12OZ 24CT';
  await addCases(page, 'red bull coconut 12', rb, 2);
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByTestId('cart-row')).toHaveCount(2);
  await expect(page.getByTestId('total-products')).toHaveText('2');
  await expect(page.getByTestId('total-cases')).toHaveText('5');
  await expect(page.getByTestId('total-value')).toHaveText('$178.95'); // 3×22.99 + 2×54.99
  await inc(page, evian).click();
  await inc(page, evian).click();
  await expect(qty(page, evian)).toHaveText('5');
  await expect(page.getByTestId('total-value')).toHaveText('$224.93');
  await searchFor(page, 'evian 0.5');
  await expect(qty(page, evian)).toHaveText('5');
  await page.click('[data-testid=nav-cart]');
  await page.getByRole('button', { name: `Remove ${rb}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('cart-row')).toHaveCount(1);
});

test('rapid tapping is counted exactly, with no duplicate cart lines, and survives a reload', async ({ page }) => {
  await addStore(page, 'Fast Store');
  const m = 'MONSTER GREEN 16OZ 24CT';
  await searchFor(page, 'monster green');
  const btn = inc(page, m);
  for (let i = 0; i < 25; i++) await btn.click({ delay: 0 });
  await expect(qty(page, m)).toHaveText('25');
  await page.reload();
  await searchFor(page, 'monster green');
  await expect(qty(page, m)).toHaveText('25');
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByTestId('cart-row')).toHaveCount(1);
});

test('QA 10-11, 17: independent drafts per store, persisted after reload; similar products stay separate', async ({ page }) => {
  await addStore(page, 'Store One', '1 First Ave', { phone: '305-111-1111', manager: 'Ann' });
  await addStore(page, 'Store Two', '2 Second Ave');
  await selectStore(page, 'Store One');
  await searchFor(page, 'pellegrino');
  await inc(page, 'SAN PELLEGRINO CAN 330ML 24PK').click();
  await inc(page, 'SAN PELLEGRINO PET 1L 12CT').click();
  await inc(page, 'SAN PELLEGRINO PET 1L 12CT').click();
  await selectStore(page, 'Store Two');
  await expect(page.getByTestId('cart-badge')).toHaveCount(0);
  await addCases(page, 'gatorade cool blue 28', 'GATORADE COOL BLUE 28OZ 15PK', 1);
  await page.reload();
  await expect(page.getByTestId('store-selector')).toContainText('Store Two');
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByTestId('cart-row')).toHaveCount(1);
  await expect(page.getByTestId('total-value')).toHaveText('$29.99');
  await selectStore(page, 'Store One');
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByTestId('cart-row')).toHaveCount(2);
  await expect(page.getByTestId('total-cases')).toHaveText('3');
  await expect(page.getByTestId('total-value')).toHaveText('$78.97'); // 18.99 + 2×29.99
  await page.click('[data-testid=nav-stores]');
  await expect(page.getByText('305-111-1111')).toBeVisible();
});

test('QA 14-16: order PDF (no prices) and detailed PDF, multi-page, rep phone from Settings', async ({ page }) => {
  await addStore(page, "Joe's Market & Deli", '77 Ocean Blvd, Miami, FL 33139', { phone: '(305) 555-0123', manager: 'Joe Smith', isNew: false });
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
  const firstName = (await page.getByTestId('cart-row').first().locator('.font-semibold').first().innerText()).trim();
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const o = await download(page, 'Download Order PDF');
  expect(o.name).toBe(`Order_Joe_s_Market_Deli_${ymd}.pdf`);
  expect(o.pages.length).toBeGreaterThan(1);
  for (const s of ["Joe's Market & Deli", '77 Ocean Blvd, Miami, FL 33139', '(305) 555-0123', 'Joe Smith', 'Vishwak', REP_PHONE, 'A2Z Beverage Distributors', 'Total Products:', 'Total Cases:', '69', firstName]) expect(o.text).toContain(s);
  for (const pg of o.pages) expect(pg).toContain('Quantity (Cases)');
  expect(o.text).not.toMatch(/\$\d/);
  expect(o.text).not.toContain('NEW STORE'); // not marked as a new store

  const d = await download(page, 'Download Detailed Order PDF');
  expect(d.name).toBe(`Order_Detailed_Joe_s_Market_Deli_${ymd}.pdf`);
  for (const pg of d.pages) expect(pg).toContain('Price/Case');
  expect(d.text).toContain('Total Order Value:');
  expect(d.text).toContain(value);
  expect(d.text).toContain(REP_PHONE);

  // a changed phone number in Settings is used from then on
  await page.click('[data-testid=nav-settings]');
  await expect(page.locator('input[name=repPhone]')).toHaveValue(REP_PHONE);
  await page.fill('input[name=repPhone]', '(786) 555-0199');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.click('[data-testid=nav-cart]');
  expect((await download(page, 'Download Order PDF', 'changed-')).text).toContain('(786) 555-0199');
});

test('NEW STORE — FIRST ORDER appears only on the first finalized order of a new store', async ({ page }) => {
  await addStore(page, 'Sunrise Mini Mart', '210 Atlantic Ave, Pompano Beach, FL', { manager: 'John' });
  await addStore(page, 'Old Friend Market', '5 Elm St', { isNew: false });
  await page.click('[data-testid=nav-stores]');
  await expect(page.getByText('NEW · first order pending')).toHaveCount(1);
  await selectStore(page, 'Sunrise Mini Mart');
  await addCases(page, 'coke 20oz', 'COKE 20OZ 24CT', 3);
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByTestId('new-store-banner')).toBeVisible();
  // downloading from the cart (a draft) shows the label but does not use it up
  expect((await download(page, 'Download Order PDF', 'draft1-')).text).toContain('NEW STORE — FIRST ORDER');
  expect((await download(page, 'Download Order PDF', 'draft2-')).text).toContain('NEW STORE — FIRST ORDER');
  await finalize(page);
  await expect(page.getByText('NEW STORE — FIRST ORDER').first()).toBeVisible();
  const first = await download(page, 'Download Order PDF', 'first-');
  expect(first.text).toContain('NEW STORE — FIRST ORDER');
  expect(first.text).toContain('Sunrise Mini Mart');
  const firstUrl = page.url();
  // second order for the same store: no label
  await selectStore(page, 'Sunrise Mini Mart');
  await addCases(page, 'sprite 20oz', 'SPRITE 20OZ 24CT', 1);
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByTestId('new-store-banner')).toHaveCount(0);
  await finalize(page);
  expect((await download(page, 'Download Order PDF', 'second-')).text).not.toContain('NEW STORE');
  // existing store never gets the label
  await selectStore(page, 'Old Friend Market');
  await addCases(page, 'sprite 20oz', 'SPRITE 20OZ 24CT', 1);
  await finalize(page);
  expect((await download(page, 'Download Order PDF', 'existing-')).text).not.toContain('NEW STORE');
  // re-downloading the original first order (after a reload) keeps its historical label
  await page.goto(firstUrl);
  await page.reload();
  expect((await download(page, 'Download Order PDF', 'redownload-')).text).toContain('NEW STORE — FIRST ORDER');
});

test('QA 18: completed orders keep their prices after a price change; reopen and re-download', async ({ page }) => {
  await addStore(page, 'History Store');
  await addCases(page, 'celsius orange', 'CELSIUS ORANGE 12OZ 12CT', 2);
  await finalize(page);
  await expect(page.getByText('$40.98').first()).toBeVisible();
  await page.goto('/#/settings/products');
  await page.getByRole('button', { name: /Price sheet lines/ }).click();
  await page.fill('input[aria-label="Search products and prices"]', 'celsius');
  await page.getByRole('button', { name: /CELSIUS 12OZ \/ 12CT/ }).click();
  await page.getByRole('alertdialog').locator('input').fill('25.00');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save' }).click();
  await searchFor(page, 'celsius orange');
  await expect(page.getByTestId('product-row').first()).toContainText('$25.00');
  await page.click('[data-testid=nav-orders]');
  await expect(page.getByText('$40.98')).toBeVisible();
  await page.getByText('History Store').click();
  await expect(page.getByText('$20.49').first()).toBeVisible();
  const d = await download(page, 'Download Detailed Order PDF', 'history-');
  expect(d.text).toContain('$20.49');
  expect(d.text).toContain('$40.98');
  expect(d.text).not.toContain('$25.00');
  await page.getByRole('button', { name: 'Copy to new draft' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByTestId('total-value')).toHaveText('$50.00');
});

test('QA 12-13: catalog CSV import, manual match persists after reload, unpriced warning', async ({ page }) => {
  const csv = [
    'department,category,brand,name,variation,units_per_case,sku',
    'WATER,Bottled Water,Evian,Natural Spring Water,500ML 24PK,24,',
    'WATER,Bottled Water,Saratoga,Spring Water,28OZ 12PK,12,',
    'SNACKS,Chips,Lays,Classic Potato Chips,1.5OZ 64CT,64,LAY-001',
  ].join('\n');
  await page.goto('/#/settings/import-catalog');
  await page.setInputFiles('[data-testid=catalog-file]', { name: 'catalog-additions.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('3 products found')).toBeVisible();
  await page.locator('input[name=completeCatalog]').uncheck(); // only a few additions
  await page.getByRole('button', { name: 'Import 3 products' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click();
  await expect(page).toHaveURL(/#\/settings\/review/);
  const sara = page.locator('li', { hasText: 'Saratoga Spring Water 28OZ 12PK' });
  await expect(sara.getByText('Suggested match')).toBeVisible(); // STILL or SPARKLING? → review, never auto
  await sara.getByRole('button', { name: 'Choose Different Product' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /SARATOGA WATER STILL 28OZ \/ 12CT/ }).first().click();
  await expect(page.getByText('Matched to SARATOGA WATER STILL 28OZ / 12CT')).toBeVisible(); // saved
  await page.reload();
  await page.getByRole('button', { name: /^Matched/ }).click();
  await expect(page.locator('li', { hasText: 'Saratoga Spring Water 28OZ 12PK' }).getByText('confirmed by you')).toBeVisible();
  await addStore(page, 'Snack Store');
  await searchFor(page, 'lays classic');
  await expect(page.getByTestId('product-row').first()).toContainText('Price not available');
  await inc(page, 'Lays Classic Potato Chips 1.5OZ 64CT').click();
  await addCases(page, 'saratoga spring water 28', 'Saratoga Spring Water 28OZ 12PK', 1);
  await expect(page.getByTestId('product-row').first()).toContainText('$24.49');
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByRole('alert').filter({ hasText: 'have no price' })).toContainText('1 product(s) have no price');
  await expect(page.getByTestId('total-value')).toHaveText('$24.49');
  const d = await download(page, 'Download Detailed Order PDF', 'unpriced-');
  expect(d.text).toContain('N/A');
  expect(d.text).toContain('NOT included in the Total Order Value');
});

test('price sheet PDF upload: extracts all 131 lines and shows them as unchanged', async ({ page }) => {
  await page.goto('/#/settings/import-prices');
  await page.setInputFiles('[data-testid=price-file]', PRICE_PDF);
  await expect(page.getByText('131 lines found')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('131 unchanged')).toBeVisible();
  await expect(page.getByText('0 new')).toBeVisible();
  await expect(page.getByText('0 price changes')).toBeVisible();
});

test('QA 19: stays responsive with 1,700+ products (CPU throttled 4x like a budget phone)', async ({ page }) => {
  const before = Number((await page.getByText(/\d+ products ·/).innerText()).match(/\d+/)![0]);
  const lines = ['department,category,brand,name,variation,units_per_case,sku'];
  const brands = ['Lays', 'Doritos', 'Cheetos', 'Snickers', 'Twix', 'Skittles', 'Pringles', 'Oreo', 'Ritz', 'Tums'];
  for (let i = 0; i < 1200; i++) lines.push(`SNACKS,Cat ${i % 9},${brands[i % 10]},Item ${i},${(i % 20) + 1}OZ ${[12, 24, 48][i % 3]}CT,${[12, 24, 48][i % 3]},SKU${100000 + i}`);
  await page.goto('/#/settings/import-catalog');
  await page.setInputFiles('[data-testid=catalog-file]', { name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')) });
  await page.locator('input[name=completeCatalog]').uncheck();
  await page.getByRole('button', { name: 'Import 1200 products' }).click();
  const tImport = Date.now();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click();
  await expect(page).toHaveURL(/#\/settings\/review/, { timeout: 90_000 });
  console.log(`PERF import + match 1200 extra products: ${Date.now() - tImport} ms`);
  await page.click('[data-testid=nav-products]');
  await expect(page.getByText(`${before + 1200} products`)).toBeVisible();
  await addStore(page, 'Perf Store');
  await page.click('[data-testid=nav-products]');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let t0 = Date.now();
  await page.fill('input[aria-label="Search products"]', 'doritos item 1');
  await expect(page.getByTestId('product-row').first()).toContainText('Doritos');
  const searchMs = Date.now() - t0;
  await page.fill('input[aria-label="Search products"]', '');
  const b = page.getByRole('button', { name: /^Increase / }).first();
  t0 = Date.now();
  for (let i = 0; i < 10; i++) await b.click();
  await expect(page.getByTestId('qty').first()).toHaveText('10');
  const tapMs = (Date.now() - t0) / 10;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(`PERF (4x CPU throttle, ${before + 1200} products): search ${searchMs} ms, per tap ${tapMs.toFixed(0)} ms (incl. test-driver overhead)`);
  expect(searchMs).toBeLessThan(1500);
  expect(tapMs).toBeLessThan(400);
});

test('QA 20: backup and restore round-trip without data loss', async ({ page, browser }) => {
  await addStore(page, 'Backup Store', '9 Backup Rd', { phone: '111', manager: 'Bob' });
  await addCases(page, 'bang orange', 'BANG ORANGE 16OZ 12PK', 2);
  await page.goto('/#/settings/backup');
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup file' }).click()]);
  const file = `${OUT}/${d.suggestedFilename()}`;
  await d.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(json.app).toBe('a2z-order-app');
  expect(json.tables.stores.length).toBe(1);
  expect(json.tables.stores[0].isNew).toBe(true);
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
  await expect(p2.getByTestId('new-store-banner')).toBeVisible(); // first-order status travels with the backup
  await p2.goto('/#/settings/backup');
  const [d2] = await Promise.all([p2.waitForEvent('download'), p2.getByRole('button', { name: 'Download backup file' }).click()]);
  const json2 = JSON.parse(fs.readFileSync(await d2.path(), 'utf8'));
  for (const t of ['stores', 'drafts', 'orders', 'products', 'priceItems', 'mappings']) expect(JSON.stringify(json2.tables[t])).toBe(JSON.stringify(json.tables[t]));
  await ctx2.close();
});

test('weekly report: auto-finalized after Friday, multiple orders per store, 1% commission, week 2 non-ordering stores, history unchanged', async ({ page }) => {
  const nyTime = (iso: string) => new Date(iso); // ISO strings below are UTC; New York is UTC-5 in Nov/Dec
  await page.clock.setFixedTime(nyTime('2026-11-23T14:00:00Z')); // Mon Nov 23, 9:00 AM New York (week 1)
  await page.goto('/');
  await expect(page.getByTestId('product-row').first()).toBeVisible();
  await addStore(page, 'ABC Convenience', 'Deerfield Beach, FL');
  await addStore(page, 'XYZ Market', 'Pompano Beach, FL');
  await addStore(page, 'Regular Customer', 'Hollywood, FL', { isNew: false });
  await selectStore(page, 'ABC Convenience');
  await addCases(page, 'gatorade cool blue 20', 'GATORADE COOL BLUE 20OZ 24PK', 2); // 2 × 23.99
  await finalize(page);
  await selectStore(page, 'ABC Convenience');
  await addCases(page, 'monster green', 'MONSTER GREEN 16OZ 24CT', 3); // 3 × 38.50
  await finalize(page);
  await selectStore(page, 'XYZ Market');
  await addCases(page, 'coke 20oz', 'COKE 20OZ 24CT', 4); // 4 × 32.99
  await finalize(page);
  // provisional report during the week
  await page.goto('/#/reports');
  await expect(page.getByText('Week 1').first()).toBeVisible();
  await page.getByTestId('generate-report').click();
  await expect(page.getByText('PROVISIONAL.')).toBeVisible();
  const prov = await download(page, 'Download Weekly Report PDF', 'prov-');
  expect(prov.name).toBe('Weekly_Sales_Report_2026-11-21_to_2026-11-27_PROVISIONAL.pdf');

  // Friday 11:59:59 PM passes → week 1 is finalized automatically when the app is opened
  await page.clock.setFixedTime(nyTime('2026-11-28T05:00:30Z')); // Sat Nov 28, 12:00:30 AM New York
  await page.goto('/#/reports');
  await page.reload();
  const hist = page.getByTestId('report-history');
  await expect(hist).toContainText('Week 1');
  await expect(hist).toContainText('$295.44'); // 47.98 + 115.50 + 131.96
  await expect(hist).toContainText('$2.95'); // 1% of $295.44 = $2.9544
  await hist.getByRole('link', { name: 'Week 1' }).click();
  await expect(page.getByTestId('metric-new-stores-added')).toHaveText('2'); // ABC + XYZ (Regular Customer not marked new)
  await expect(page.getByTestId('metric-total-orders-received')).toHaveText('3');
  await expect(page.getByTestId('metric-stores-that-placed-orders')).toHaveText('2'); // ABC counted once
  await expect(page.getByTestId('metric-stores-without-orders')).toHaveText('Not Applicable — First Week');
  await expect(page.getByTestId('metric-total-cases-ordered')).toHaveText('9');
  await expect(page.getByTestId('commission')).toContainText('$2.95');
  const w1 = await download(page, 'Download Weekly Report PDF', 'w1-');
  expect(w1.name).toBe('Weekly_Sales_Report_2026-11-21_to_2026-11-27.pdf');
  for (const s of ['WEEKLY SALES & COMMISSION REPORT', 'Report ID: WR-2026-11-21', 'Vishwak', REP_PHONE, 'ABC Convenience', 'Deerfield Beach, FL', '$163.48', '$295.44', '$2.95', 'Not Applicable — First Week']) expect(w1.text).toContain(s);

  // week 2: only XYZ orders → ABC and Regular Customer did not order
  await page.clock.setFixedTime(nyTime('2026-12-01T15:00:00Z')); // Tue Dec 1, 10:00 AM
  await page.goto('/');
  await selectStore(page, 'XYZ Market');
  await addCases(page, 'sprite 20oz', 'SPRITE 20OZ 24CT', 1);
  await finalize(page);
  await page.clock.setFixedTime(nyTime('2026-12-05T05:00:30Z')); // Sat Dec 5, 12:00:30 AM
  await page.goto('/#/reports');
  await page.reload();
  await expect(hist).toContainText('Week 2');
  await hist.getByRole('link', { name: 'Week 2' }).click();
  await expect(page.getByTestId('metric-stores-without-orders')).toHaveText('2');
  await expect(page.getByTestId('non-ordering-count')).toHaveText('2');
  await expect(page.getByText('No Previous Order')).toBeVisible(); // Regular Customer never ordered
  await expect(page.getByTestId('commission')).toContainText('$0.33'); // 1% of $32.99
  // week 1 is unchanged
  await page.goto('/#/reports/WR-2026-11-21');
  await expect(page.getByTestId('metric-total-weekly-sales')).toHaveText('$295.44');
  await expect(page.getByTestId('metric-total-orders-received')).toHaveText('3');
});

test('@smoke works offline after the first visit (installed PWA)', async ({ page, context }) => {
  await page.waitForFunction(async () => !!(await navigator.serviceWorker?.ready)?.active, null, { timeout: 30_000 });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('product-row').first()).toBeVisible();
  await addStore(page, 'Offline Store');
  await addCases(page, 'arizona sweet tea 20', 'ARIZONA SWEET TEA 20OZ 24CT', 1);
  await page.click('[data-testid=nav-cart]');
  await expect(page.getByTestId('total-value')).toHaveText('$18.49');
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Order PDF' }).click()]);
  expect(d.suggestedFilename()).toMatch(/^Order_Offline_Store_\d{4}-\d{2}-\d{2}\.pdf$/);
  await context.setOffline(false);
});

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { AppDB, useDb, db } from '../src/db/db';
import * as S from '../src/state/store';
import { applyCatalog, applyPriceSheet, diffPriceSheet } from '../src/db/importer';
import { matchProduct, scoreCandidate } from '../src/lib/matching';
import { buildIndex, search } from '../src/lib/search';
import { computeTotals, displayName } from '../src/lib/products';
import { parseMoneyToCents, formatCents } from '../src/lib/money';
import { parsePack, parseSize, sameSize } from '../src/lib/normalize';
import { validateBackup } from '../src/db/backup';
import type { PriceItem, Product } from '../src/types';
import { BUNDLED_DATASETS } from '../src/data/bundled';

// These tests cover price-sheet behaviour and generic matching, so they start from the price
// sheet only. The real catalog (bundled v2+) is covered in tests/catalog.test.ts.
BUNDLED_DATASETS.splice(1);

let n = 0;
async function freshApp() {
  useDb(new AppDB(`test-${++n}`));
  await S.init();
  return S.getState();
}
const byName = (frag: string) => S.getState().products.find((p) => displayName(p) === frag)!;

describe('money & normalization', () => {
  it('parses money exactly in cents', () => {
    expect(parseMoneyToCents('$12.50')).toBe(1250);
    expect(parseMoneyToCents('19.9')).toBe(1990);
    expect(parseMoneyToCents('1,234.05')).toBe(123405);
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(formatCents(8250)).toBe('$82.50');
  });
  it('understands sizes and case counts', () => {
    expect(sameSize(parseSize('16.9OZ'), parseSize('500 ml'))).toBe(true);
    expect(sameSize(parseSize('0.5L'), parseSize('500ML'))).toBe(true);
    expect(sameSize(parseSize('16OZ'), parseSize('500ML'))).toBe(false);
    expect(parsePack('12OZ / 2-12CT')!.units).toBe(24);
    expect(parsePack('Brand A 500ML 24PK')!.units).toBe(24);
    expect(parsePack('SMALL / 1200 BAGS')!.units).toBe(1200);
  });
  it('totals: products, cases and value (decimal-safe)', () => {
    const prices: Record<string, number | null> = { a: 1250, b: 1500, c: 1000, d: null };
    const t = computeTotals(
      [
        { productId: 'a', qty: 1 },
        { productId: 'b', qty: 2 },
        { productId: 'c', qty: 4 },
      ],
      (id) => prices[id],
    );
    expect(t).toEqual({ products: 3, cases: 7, valueCents: 8250, unpricedLines: 0, unpricedCases: 0 });
    // 0.1 + 0.2 style cases stay exact
    const t2 = computeTotals(Array.from({ length: 10 }, (_, i) => ({ productId: 'x' + i, qty: 3 })), () => 1999);
    expect(t2.valueCents).toBe(59970);
    const t3 = computeTotals([{ productId: 'a', qty: 2 }, { productId: 'd', qty: 5 }], (id) => prices[id]);
    expect(t3).toMatchObject({ products: 2, cases: 7, valueCents: 2500, unpricedLines: 1, unpricedCases: 5 });
  });
});

describe('seed data', () => {
  it('loads the 131 real A2Z price lines on first run, all priced', async () => {
    const s = await freshApp();
    expect(s.priceItems.length).toBe(131);
    expect(s.browseIds.length).toBe(131);
    expect(s.departments).toEqual(['WATER', 'SODA', 'SPORTS DRINKS', 'JUICES', 'SHOPPING BAGS', 'ENERGY ENHANCER / DRINKS', 'MILK']);
    const z = byName('ZEPHYRHILLS 20OZ / 28CT');
    expect(S.priceOf(z.id)).toBe(1249);
    expect(z.unitsPerCase).toBe(28);
    expect(s.settings.repName).toBe('Vishwak');
    expect(s.settings.repPhone).toBe('');
    // similar names are separate products
    expect(byName('SAN PELLEGRINO 750ML / 12CT (GLASS)').id).not.toBe(byName('SAN PELLEGRINO 1L / 12CT (PLASTIC)').id);
  });
  it('does not seed twice', async () => {
    await freshApp();
    await S.init();
    expect(await db.priceItems.count()).toBe(131);
  });
});

describe('cart & stores', () => {
  beforeEach(async () => {
    await freshApp();
  });
  it('requires a store, increments, decrements, never negative, auto add/remove', async () => {
    const water = byName('EVIAN WATER 500ML / 24CT');
    expect(S.changeQty(water.id, 1)).toBe(false); // no store selected
    const a = await S.saveStore({ name: 'ABC Convenience', address: '1 Main St' });
    await S.selectStore(a.id);
    for (let i = 0; i < 3; i++) S.changeQty(water.id, +1);
    expect(S.currentLines()).toEqual([{ productId: water.id, qty: 3 }]);
    S.changeQty(water.id, -1);
    expect(S.currentLines()[0].qty).toBe(2);
    S.changeQty(water.id, -1);
    S.changeQty(water.id, -1);
    expect(S.currentLines()).toEqual([]); // removed at 0
    S.changeQty(water.id, -1);
    expect(S.currentLines()).toEqual([]); // never negative
    S.setQty(water.id, -5);
    expect(S.currentLines()).toEqual([]);
  });
  it('rapid taps produce no duplicates and persist the final quantity', async () => {
    const a = await S.saveStore({ name: 'A', address: 'x' });
    await S.selectStore(a.id);
    const p = byName('RED BULL 8OZ / 24CT');
    for (let i = 0; i < 50; i++) S.changeQty(p.id, 1);
    for (let i = 0; i < 20; i++) S.changeQty(p.id, -1);
    expect(S.currentLines()).toEqual([{ productId: p.id, qty: 30 }]);
    await S.flushDrafts();
    expect((await db.drafts.get(a.id))!.lines).toEqual([{ productId: p.id, qty: 30 }]);
  });
  it('each store keeps an independent draft that survives reload', async () => {
    const a = await S.saveStore({ name: 'Store A', address: 'a st', phone: '555', manager: 'Ann' });
    const b = await S.saveStore({ name: 'Store B', address: 'b st' });
    const w1 = byName('AQUAFINA 20OZ / 24CT');
    const w2 = byName('MONSTER 16OZ / 24CT');
    await S.selectStore(a.id);
    S.setQty(w1.id, 3);
    S.setQty(w2.id, 2);
    await S.selectStore(b.id);
    expect(S.currentLines()).toEqual([]);
    S.setQty(w1.id, 7);
    await S.flushDrafts();
    await S.reload(); // simulate refresh
    expect(S.getState().settings.selectedStoreId).toBe(b.id);
    expect(S.currentLines()).toEqual([{ productId: w1.id, qty: 7 }]);
    await S.selectStore(a.id);
    expect(S.currentLines()).toEqual([
      { productId: w1.id, qty: 3 },
      { productId: w2.id, qty: 2 },
    ]);
    const t = S.cartTotals(S.currentLines());
    expect(t).toMatchObject({ products: 2, cases: 5, valueCents: 3 * 2499 + 2 * 3850 });
    expect(S.getState().stores.find((s) => s.id === a.id)).toMatchObject({ phone: '555', manager: 'Ann' });
  });
  it('finalized orders are immutable snapshots; price changes do not alter them', async () => {
    const a = await S.saveStore({ name: 'Store A', address: 'a st' });
    await S.selectStore(a.id);
    const p = byName('GATORADE 20OZ / 24CT');
    S.setQty(p.id, 4);
    const order = await S.finalizeOrder(a.id);
    expect(order.lines[0]).toMatchObject({ name: 'GATORADE 20OZ / 24CT', priceCents: 2399, qty: 4, lineTotalCents: 9596 });
    expect(S.currentLines()).toEqual([]);
    // price update through a new price sheet
    await S.setPriceItemPrice(p.priceItemId!, 2599);
    expect(S.priceOf(p.id)).toBe(2599);
    const again = await S.getOrder(order.id);
    expect(again!.lines[0].priceCents).toBe(2399);
    expect(again!.totals.valueCents).toBe(9596);
    // copy to a new draft uses current prices, order unchanged
    await S.copyOrderToDraft(again!);
    expect(S.currentLines()).toEqual([{ productId: p.id, qty: 4 }]);
    expect(S.cartTotals(S.currentLines()).valueCents).toBe(4 * 2599);
    expect((await S.getOrder(order.id))!.totals.valueCents).toBe(9596);
  });
});

describe('price sheet updates', () => {
  it('updates prices, adds new lines, flags (never deletes) missing ones, and active carts see new prices', async () => {
    await freshApp();
    const a = await S.saveStore({ name: 'A', address: 'x' });
    await S.selectStore(a.id);
    const p = byName('CELSIUS 12OZ / 12CT');
    S.setQty(p.id, 2);
    const rows = [
      { section: 'ENERGY ENHANCER / DRINKS', brand: 'CELSIUS', desc: '12OZ / 12CT', priceCents: 2149, raw: 'x' },
      { section: 'ENERGY ENHANCER / DRINKS', brand: 'CELSIUS', desc: '16OZ / 12CT', priceCents: 2699, raw: 'y' },
    ];
    const diff = await diffPriceSheet(rows);
    expect(diff.rows.map((r) => r.status)).toEqual(['changed', 'new']);
    expect(diff.missing.length).toBe(130);
    const sum = await S.applyPriceSheet(rows, 'update.pdf');
    expect(sum).toEqual({ added: 1, changed: 1, same: 0, missing: 130 });
    expect(S.getState().products.length).toBe(132); // nothing deleted
    expect(S.priceOf(p.id)).toBe(2149);
    expect(S.cartTotals(S.currentLines()).valueCents).toBe(4298);
    expect(S.getState().priceItems.filter((i) => i.missingFromLatest).length).toBe(130);
    expect((await db.snapshots.count()) > 0).toBe(true);
  });
});

describe('catalog matching', () => {
  it('auto-matches only unambiguous products; others go to review / unmatched', async () => {
    await freshApp();
    const sum = await S.applyCatalog(
      [
        // clear, unique matches
        { department: 'Water', category: 'Bottled Water', brand: 'Evian', name: 'Natural Spring Water', variation: '500ML 24PK', unitsPerCase: null, sku: '', raw: 'Evian Natural Spring Water 500ML 24PK' },
        { department: 'Soda', category: 'Cola', brand: 'Coca-Cola', name: 'Classic', variation: '20 oz 24 pack', unitsPerCase: null, sku: '', raw: 'Coca-Cola Classic 20 oz 24 pack' },
        // ambiguous: Saratoga has STILL and SPARKLING 28OZ/12CT lines
        { department: 'Water', category: 'Bottled Water', brand: 'Saratoga', name: 'Water', variation: '28OZ 12PK', unitsPerCase: null, sku: '', raw: 'Saratoga Water 28OZ 12PK' },
        // packaging not stated while price line is GLASS -> review
        { department: 'Water', category: 'Sparkling', brand: 'San Pellegrino', name: 'Sparkling Water', variation: '750ML 12PK', unitsPerCase: null, sku: '', raw: 'San Pellegrino Sparkling Water 750ML 12PK' },
        // size that does not exist on the price sheet -> unmatched
        { department: 'Water', category: 'Bottled Water', brand: 'Evian', name: 'Water', variation: '200ML 24PK', unitsPerCase: null, sku: '', raw: 'Evian Water 200ML 24PK' },
        // not on the price sheet at all
        { department: 'Snacks', category: 'Chips', brand: 'Lays', name: 'Classic', variation: '1.5OZ 64CT', unitsPerCase: null, sku: '', raw: 'Lays Classic 1.5OZ 64CT' },
        // 24 cans vs "2-12CT" price line -> review, not auto
        { department: 'Soda', category: 'Cola', brand: 'Pepsi', name: 'Cola Cans', variation: '12OZ 24CT', unitsPerCase: null, sku: '', raw: 'Pepsi Cola Cans 12OZ 24CT' },
      ],
      'catalog.pdf',
    );
    const st = (raw: string) => S.getState().products.find((p) => p.catalogName === raw)!;
    expect(st('Evian Natural Spring Water 500ML 24PK').matchStatus).toBe('matched');
    expect(S.priceOf(st('Evian Natural Spring Water 500ML 24PK').id)).toBe(2299);
    expect(st('Coca-Cola Classic 20 oz 24 pack').matchStatus).toBe('matched');
    expect(S.priceOf(st('Coca-Cola Classic 20 oz 24 pack').id)).toBe(3299);
    expect(st('Saratoga Water 28OZ 12PK').matchStatus).toBe('review');
    expect(S.priceOf(st('Saratoga Water 28OZ 12PK').id)).toBeNull(); // never an uncertain price
    expect(st('San Pellegrino Sparkling Water 750ML 12PK').matchStatus).toBe('review');
    expect(st('Evian Water 200ML 24PK').matchStatus).not.toBe('matched');
    expect(st('Lays Classic 1.5OZ 64CT').matchStatus).toBe('unmatched');
    expect(S.priceOf(st('Lays Classic 1.5OZ 64CT').id)).toBeNull();
    expect(st('Pepsi Cola Cans 12OZ 24CT').matchStatus).toBe('review');
    expect(sum.added).toBe(7);
    // the price-sheet product that a catalog product now covers is hidden from browsing (no duplicates)
    const evianSheet = byName('EVIAN WATER 500ML / 24CT');
    expect(S.getState().browseIds.includes(evianSheet.id)).toBe(false);
    expect(S.getState().browseIds.includes(st('Evian Natural Spring Water 500ML 24PK').id)).toBe(true);
    // unmatched catalog products still appear in the catalog
    expect(S.getState().browseIds.includes(st('Lays Classic 1.5OZ 64CT').id)).toBe(true);

    // manual confirmation is saved permanently and survives re-import
    const sara = st('Saratoga Water 28OZ 12PK');
    const still28 = S.getState().priceItems.find((i) => i.brand === 'SARATOGA WATER' && i.desc === 'STILL 28OZ / 12CT')!;
    await S.confirmMatch(sara.id, still28.id);
    expect(S.priceOf(sara.id)).toBe(2449);
    await applyCatalog([{ department: 'Water', category: 'Bottled Water', brand: 'Saratoga', name: 'Water', variation: '28OZ 12PK', unitsPerCase: null, sku: '', raw: 'Saratoga Water 28OZ 12PK' }], 'catalog2.pdf');
    await applyPriceSheet([{ section: 'WATER', brand: 'SARATOGA WATER', desc: 'STILL 28OZ / 12CT', priceCents: 2500, raw: 'r' }], 'sheet2.pdf');
    await S.reload();
    expect(S.getState().products.find((p) => p.id === sara.id)!.matchStatus).toBe('matched');
    expect(S.priceOf(sara.id)).toBe(2500);
    // leave unmatched is remembered too
    const lays = st('Lays Classic 1.5OZ 64CT');
    await S.leaveUnmatched(lays.id);
    expect(S.getState().productById.get(lays.id)!.matchMethod).toBe('manual');
  });
  it('SKU matching wins when both sides have the same code', () => {
    const item = { id: 'i1', key: 'k', section: '', brand: 'X', desc: 'whatever', sku: 'A123', priceCents: 100 } as PriceItem;
    const c = scoreCandidate({ brand: 'Other', name: 'Name', variation: '', sku: 'a123', unitsPerCase: null, catalogName: '' }, item);
    expect(c?.strong).toBe(true);
    const r = matchProduct({ brand: 'Other', name: 'Name', variation: '', sku: 'A123', unitsPerCase: null, catalogName: '' }, [item], new Map());
    expect(r).toMatchObject({ status: 'matched', method: 'sku' });
  });
});

describe('search', () => {
  it('finds products by partial names, sizes, departments and typos', async () => {
    const s = await freshApp();
    const names = (q: string) => search(q, s.browseIds, s.index).map((id) => displayName(s.productById.get(id)!));
    expect(names('500 water').slice(0, 6)).toEqual(expect.arrayContaining(['EVIAN WATER 500ML / 24CT', 'ACQUA PANNA 500ML / 24CT']));
    expect(names('500 water')).toContain('AQUAFINA 16.9OZ / 32CT'); // 16.9oz = 500mL
    expect(names('zeph 20')[0]).toBe('ZEPHYRHILLS 20OZ / 28CT');
    expect(names('pellegrno').length).toBe(5);
    expect(names('smartwater').length).toBe(4);
    expect(names('red bull 12')[0]).toBe('RED BULL 12OZ / 24CT');
    expect(names('energy').length).toBe(12);
    expect(names('sprite 2l')).toEqual(['COKE / FANTA / SPRITE & FLAVORS 2L / 8CT']);
    expect(names('xyzxyz')).toEqual([]);
  });
  it('stays fast with 2,000+ products', () => {
    const products: Product[] = [];
    const brands = ['Evian', 'Fiji', 'Dasani', 'Coke', 'Pepsi', 'Monster', 'Red Bull', 'Lays', 'Doritos', 'Snickers'];
    for (let i = 0; i < 2500; i++) {
      products.push({
        id: 'p' + i, origin: 'catalog', department: ['Water', 'Soda', 'Snacks'][i % 3], category: 'Cat ' + (i % 17), brand: brands[i % 10],
        name: 'Product ' + i, variation: `${(i % 30) + 8}OZ / ${[12, 24, 6][i % 3]}CT`, unitsPerCase: 24, sku: String(100000 + i), catalogName: '',
        priceItemId: null, priceOverrideCents: 100, matchStatus: 'matched', matchMethod: 'manual', matchScore: 1, suggestedPriceItemId: null, active: true, order: i, createdAt: 0, updatedAt: 0,
      });
    }
    let t0 = performance.now();
    const idx = buildIndex(products);
    const buildMs = performance.now() - t0;
    const ids = products.map((p) => p.id);
    t0 = performance.now();
    for (const q of ['evian 20', 'red bull', 'product 12', 'snack', 'monstr', '100250']) search(q, ids, idx);
    const perQuery = (performance.now() - t0) / 6;
    expect(search('100250', ids, idx)[0]).toBe('p250');
    expect(buildMs).toBeLessThan(500);
    expect(perQuery).toBeLessThan(50);
  });
});

describe('backup & restore', () => {
  it('round-trips all data without corruption', async () => {
    await freshApp();
    const a = await S.saveStore({ name: 'Store A', address: 'addr', phone: '1', manager: 'M' });
    await S.selectStore(a.id);
    S.setQty(byName('BANG 16OZ / 12CT').id, 6);
    await S.updateSettings({ repPhone: '(305) 000-0000' });
    await S.finalizeOrder(a.id);
    S.setQty(byName('BLOOM 12OZ / 12CT').id, 2);
    const backup = JSON.parse(JSON.stringify(await S.makeBackup()));
    expect(validateBackup(backup)).toEqual([]);
    const before = JSON.stringify(backup.tables);

    // wreck the data, then restore
    await S.deleteStore(a.id);
    await S.applyCatalog([{ department: 'X', category: '', brand: 'Junk', name: 'Junk', variation: '1OZ', unitsPerCase: 1, sku: '', raw: 'junk' }], 'junk.pdf');
    await S.restoreFromBackup(backup);
    const after = JSON.stringify((await S.makeBackup()).tables);
    expect(after).toBe(before);
    expect(S.getState().stores.map((s) => s.name)).toEqual(['Store A']);
    expect(S.currentLines().length).toBe(1);
    expect((await S.listOrders()).length).toBe(1);
    expect(S.getState().settings.repPhone).toBe('(305) 000-0000');
  });
  it('rejects invalid files', () => {
    expect(validateBackup({ hello: 1 }).length).toBeGreaterThan(0);
    expect(validateBackup({ app: 'a2z-order-app', version: 1, tables: { products: [{ nope: 1 }], settings: [{ id: 'app' }] } }).length).toBeGreaterThan(0);
  });
});

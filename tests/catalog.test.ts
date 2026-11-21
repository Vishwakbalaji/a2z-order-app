import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { AppDB, useDb, db } from '../src/db/db';
import * as S from '../src/state/store';
import { BUNDLED_DATASETS, LATEST_BUNDLED_VERSION } from '../src/data/bundled';
import { A2Z_CATALOG_ROWS, splitDescription } from '../src/data/a2zCatalog';
import { syncBundledData } from '../src/db/importer';
import { displayName } from '../src/lib/products';
import { search } from '../src/lib/search';
import { loadPdfPages } from './pdfNode';

let n = 0;
async function fresh() {
  useDb(new AppDB(`catalog-${++n}`));
  await S.init();
  return S.getState();
}
const cat = (desc: string) => S.getState().products.find((p) => p.origin === 'catalog' && p.catalogName === desc)!;

describe('real A2Z catalog (bundled update v2)', () => {
  it('catalog data matches the PDF: every printed description is present exactly once', async () => {
    const pages = await loadPdfPages(new URL('./fixtures/A2Z_Beverages_Product_List_11.20.26.pdf', import.meta.url).pathname);
    const printed = new Set<string>();
    for (const pg of pages) for (const it of pg.items) if (it.str.trim() && it.str.trim().length > 12) printed.add(it.str.trim());
    const descs = A2Z_CATALOG_ROWS.map((r) => r[2]);
    expect(descs.length).toBe(543);
    expect(new Set(descs).size).toBe(543); // no duplicates
    for (const d of descs) expect(printed.has(d) || d.length <= 12).toBe(true);
    // splitting into name + size never changes the text
    for (const d of descs) {
      const { name, variation } = splitDescription(d);
      expect([name, variation].filter(Boolean).join(' ')).toBe(d);
    }
  });

  it('imports all 543 products, prices only reliable matches, no duplicates, searchable at once', async () => {
    const s = await fresh();
    expect(s.settings.bundledVersion).toBe(LATEST_BUNDLED_VERSION);
    const catalog = s.products.filter((p) => p.origin === 'catalog');
    // 543 printed products; "RED BULL 20OZ 12CT" and "RED BULL 20OZ 12PK" are the same product written two ways
    expect(catalog.length).toBe(542);
    expect(new Set(catalog.map((p) => p.catalogName)).size).toBe(542);
    expect(catalog.some((p) => p.catalogName === 'RED BULL 20OZ 12CT')).toBe(true);
    const by = (st: string) => catalog.filter((p) => p.matchStatus === st).length;
    expect({ matched: by('matched'), review: by('review'), unmatched: by('unmatched') }).toEqual({ matched: 334 + 72, review: 67, unmatched: 69 }); // 334 strict + 72 accepted by the 90% rule (v4)
    expect(catalog.filter((p) => p.matchMethod === 'rule90').length).toBe(72);
    expect(s.priceItems.length).toBe(131);
    // spot checks against the price sheet
    expect(S.priceOf(cat('COKE DIET 20OZ 24CT').id)).toBe(3299);
    expect(S.priceOf(cat('PEPSI DIET 2/12 12OZ').id)).toBe(1499);
    expect(S.priceOf(cat('MONSTER WHITE ZERO ULTRA 16OZ 24CT').id)).toBe(3850);
    expect(S.priceOf(cat('RED BULL 120Z 24PK').id)).toBe(5499); // "120Z" typo read as 12OZ
    expect(S.priceOf(cat('EVIAN WATER 0.5L 24CT').id)).toBe(2299); // 0.5L = 500ML
    expect(S.priceOf(cat('SAN PELLEGRINO .5L 24PK PLASTIC').id)).toBe(2499);
    expect(S.priceOf(cat('VITA COCO 1L 12CT').id)).toBe(4999);
    // uncertain → no price, but a suggestion for review
    // accepted by the owner's 90% rule
    expect(S.priceOf(cat('COKE MEXICO 355ML 24CT').id)).toBe(4099);
    expect(cat('COKE MEXICO 355ML 24CT').matchMethod).toBe('rule90');
    expect(S.priceOf(cat('BODY ARMOUR TROPICAL PUNCH 16OZ 12C').id)).toBe(2099);
    // below 90%: still waiting for review, no price
    for (const d of ['RED BULL 8.4OZ 24PK', 'CANADA DRY GINGER ALE 20OZ 24CT', 'ZEPHYRHILLS 16.9OZ 32CT', 'MOUNTAIN DEW 2L 2-4PK']) {
      expect(cat(d).matchStatus).toBe('review');
      expect(S.priceOf(cat(d).id)).toBeNull();
    }
    // not on the price sheet at all
    expect(cat('ARIZONA CAN-GREEN TEA 22OZ 24CT').matchStatus).toBe('unmatched');
    expect(cat('TOPO CHICO WATER 16.9OZ 18CT').matchStatus).toBe('unmatched');
    // a flavour word is never taken for another brand: Red Bull Watermelon gets the Red Bull line, not the WATERMELON soda
    const rbw = cat('RED BULL WATERMELON 12OZ 24CT');
    expect(rbw.matchStatus).toBe('matched');
    expect(s.priceItemById.get(rbw.priceItemId!)!.brand).toBe('RED BULL');
    expect(S.priceOf(rbw.id)).toBe(5499);
    // catalog names are used exactly as printed (every one of them) and are searchable
    expect(displayName(cat('COKE CAN 12OZ 2/12CT'))).toBe('COKE CAN 12OZ 2/12CT');
    for (const p of catalog) expect(displayName(p)).toBe(p.catalogName);
    const names = (q: string) => search(q, s.browseIds, s.index).map((id) => displayName(s.productById.get(id)!));
    expect(names('coke zero 20')).toContain('COKE ZERO 20OZ 24CT');
    expect(names('celsius peach')).toContain('CELSIUS PEACH MANGO 12OZ 12CT');
    expect(names('electrolit')).toHaveLength(17);
    // the price-sheet product that a catalog product replaces is hidden (no duplicate entries)
    const sheetCoke = s.products.find((p) => p.origin === 'pricesheet' && displayName(p) === 'COKE / FANTA / SPRITE & FLAVORS 20OZ / 24CT')!;
    expect(s.browseIds).not.toContain(sheetCoke.id);
    // the one-time summary notice
    expect(s.settings.dataNotice?.text).toContain('72 more products now have a price. 406 of 542 catalog products are priced; 67 suggestions below 90% wait for your review and 69 are not on the price sheet.');
  });

  it('the 90% rule never overrides a decision made by hand', async () => {
    // a phone that has v1–v3 (price sheet, catalog, phone) but not yet v4
    const saved = BUNDLED_DATASETS.splice(3);
    try {
      await fresh();
      const coke = cat('COKE MEXICO 355ML 24CT');
      expect(coke.matchStatus).toBe('review');
      await S.leaveUnmatched(coke.id); // decided by hand
      const fiji = cat('FIJI WATER 1L 2/6PK');
      const other = S.getState().priceItems.find((i) => i.brand === 'FIJI WATER' && i.desc === '1.5L / 12CT')!;
      await S.confirmMatch(fiji.id, other.id); // decided by hand, different line
    } finally {
      BUNDLED_DATASETS.push(...saved);
    }
    expect(await syncBundledData()).toEqual([4]);
    await S.reload();
    expect(cat('COKE MEXICO 355ML 24CT').matchStatus).toBe('unmatched');
    expect(S.priceOf(cat('COKE MEXICO 355ML 24CT').id)).toBeNull();
    expect(S.priceOf(cat('FIJI WATER 1L 2/6PK').id)).toBe(2549); // kept the hand-picked line
    expect(cat('FIJI WATER 0.5L 4/6CT').matchMethod).toBe('rule90'); // others accepted
  });

  it('representative phone is filled in only when it is empty', async () => {
    const s = await fresh();
    expect(s.settings.repName).toBe('Vishwak');
    expect(s.settings.repPhone).toBe('+1 561-552-6556');
    // a phone the user typed is never overwritten by a later bundled settings update
    await S.updateSettings({ repPhone: '(305) 111-2222', bundledVersion: 2 });
    await syncBundledData();
    await S.reload();
    expect(S.getState().settings.repPhone).toBe('(305) 111-2222');
  });

  it('a later bundled catalog update keeps stores, carts and orders, moves carts to catalog names, applies once', async () => {
    await fresh();
    const store = await S.saveStore({ name: 'Corner Mart', address: '5 Elm St' });
    await S.selectStore(store.id);
    const sheetZeph = S.getState().products.find((p) => p.origin === 'pricesheet' && displayName(p) === 'ZEPHYRHILLS 16OZ / 32CT')!;
    expect(S.getState().browseIds).toContain(sheetZeph.id); // not replaced: the catalog's 16.9OZ is only "review"
    S.setQty(sheetZeph.id, 4);
    const gator = cat('GATORADE COOL BLUE 20OZ 24PK');
    S.setQty(gator.id, 1);
    const order = await S.finalizeOrder(store.id);
    S.setQty(sheetZeph.id, 4);
    await S.flushDrafts();

    BUNDLED_DATASETS.push({
      version: LATEST_BUNDLED_VERSION + 1,
      kind: 'catalog',
      fileName: 'next-catalog.pdf',
      rows: [
        ...BUNDLED_DATASETS.filter((d) => d.kind === 'catalog').flatMap((d) => (d.kind === 'catalog' ? d.rows : [])),
        { department: 'WATER', category: 'Zephyrhills', brand: 'Zephyrhills', name: 'ZEPHYRHILLS', variation: '16OZ 32CT', unitsPerCase: 32, sku: '', raw: 'ZEPHYRHILLS 16OZ 32CT' },
      ],
      mappings: [],
    });
    try {
      expect(await syncBundledData()).toEqual([LATEST_BUNDLED_VERSION + 1]);
      expect(await syncBundledData()).toEqual([]);
      await S.reload();
      const st = S.getState();
      const newZeph = cat('ZEPHYRHILLS 16OZ 32CT');
      expect(S.priceOf(newZeph.id)).toBe(699);
      expect(S.currentLines()).toEqual([{ productId: newZeph.id, qty: 4 }]); // cart now uses the catalog name
      expect(st.stores.map((x) => x.name)).toEqual(['Corner Mart']);
      const o = (await S.getOrder(order.id))!;
      expect(o.lines.map((l) => l.name)).toEqual(['ZEPHYRHILLS 16OZ / 32CT', 'GATORADE COOL BLUE 20OZ 24PK']); // history unchanged
      expect(st.products.filter((p) => p.origin === 'catalog').length).toBe(543);
      expect(await db.priceItems.count()).toBe(131);
    } finally {
      BUNDLED_DATASETS.pop();
    }
  });
});

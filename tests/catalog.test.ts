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
    // owner verification policy (v5): brand → type → size → exact case count; material differences are never verified
    expect({ matched: by('matched'), review: by('review'), unmatched: by('unmatched') }).toEqual({ matched: 389, review: 80, unmatched: 73 });
    expect(catalog.filter((p) => p.matchMethod === 'rule90').length).toBe(0);
    expect(s.priceItems.length).toBe(131);
    // spot checks against the price sheet
    expect(S.priceOf(cat('COKE DIET 20OZ 24CT').id)).toBe(3299);
    expect(S.priceOf(cat('PEPSI DIET 2/12 12OZ').id)).toBe(1499);
    expect(S.priceOf(cat('MONSTER WHITE ZERO ULTRA 16OZ 24CT').id)).toBe(3850);
    expect(S.priceOf(cat('RED BULL 120Z 24PK').id)).toBe(5499); // "120Z" typo read as 12OZ
    expect(S.priceOf(cat('EVIAN WATER 0.5L 24CT').id)).toBe(2299); // 0.5L = 500ML
    expect(S.priceOf(cat('SAN PELLEGRINO .5L 24PK PLASTIC').id)).toBe(2499);
    expect(S.priceOf(cat('VITA COCO 1L 12CT').id)).toBe(4999);
    expect(S.priceOf(cat('COKE MEXICO 355ML 24CT').id)).toBe(4099); // its own line, not the generic Coke can line
    expect(cat('COKE MEXICO 355ML 24CT').matchMethod).toBe('auto');
    // case count cut off in the catalog ("…16OZ 12C") but readable
    expect(S.priceOf(cat('BODY ARMOUR TROPICAL PUNCH 16OZ 12C').id)).toBe(2099);
    expect(cat('BODY ARMOUR TROPICAL PUNCH 16OZ 12C').matchBasis).toBe('count-cut-off');
    // material differences are never verified: they wait for the owner, without a price
    const flagged: [string, string][] = [
      ['SMART WATER ALKLINE 1L 12CT', 'Alkaline'],
      ['CELSIUS VRTY PACK 12OZ 12CT', 'Variety pack'],
      ['SMART WATER 700ML 24PK', 'sport-cap'],
      ['FIJI WATER 1L 2/6PK', 'multi-pack'],
      ['MINUTE MAID LEMONADE 12OZ 2/12PK', 'MINUTE MAID JUICE'],
      ['STARBUCKS COFFEE 13.7OZ 12CT', 'Size differs by 0.2 oz'],
      ['RED BULL 8.4OZ 24PK', 'more than 0.3 oz'],
      ['CANADA DRY GINGER ALE 20OZ 24CT', 'does not name the brand'],
      ['ZEPHYRHILLS 16.9OZ 32CT', 'more than 0.3 oz'],
      ['MOUNTAIN DEW 2L 2-4PK', 'multi-pack'],
    ];
    for (const [d, why] of flagged) {
      expect(cat(d).matchStatus, d).toBe('review');
      expect(S.priceOf(cat(d).id), d).toBeNull();
      expect(cat(d).matchFlags!.join(' '), d).toContain(why);
    }
    // a different case count is never matched: unmatched, the closest line kept only as information
    const ba = cat('BODY ARMOUR TROPICAL PUNCH 28OZ 12C');
    expect(ba.matchStatus).toBe('unmatched');
    expect(S.priceOf(ba.id)).toBeNull();
    expect(ba.matchFlags).toContain('Case count differs (12 vs 15)');
    expect(s.priceItemById.get(ba.suggestedPriceItemId!)!.desc).toBe('28OZ / 15CT');
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
    expect(s.settings.dataNotice?.title).toBe('Prices re-checked with your verification rules');
    expect(s.settings.dataNotice?.text).toContain('389 catalog products verified (coverage 71.8%). 80 wait for your confirmation and 73 have no price line.');
  });

  it('the v5 re-check keeps decisions made by hand, past orders and carts', async () => {
    // a phone that has v1–v4 but not yet v5, with prices accepted by the old 90% rule
    const saved = BUNDLED_DATASETS.splice(4);
    let orderId = '';
    try {
      await fresh();
      const items = S.getState().priceItems;
      const line = (b: string, d: string) => items.find((i) => i.brand === b && i.desc === d)!;
      // what the old 90% rule had accepted on this phone
      for (const [d, b, l] of [
        ['SMART WATER ALKLINE 1L 12CT', 'SMART WATER', '1L / 12CT'],
        ['SMART WATER ALKLINE 1.5L 12CT', 'SMART WATER', '1.5L / 12CT'],
        ['CELSIUS VRTY PACK 12OZ 12CT', 'CELSIUS', '12OZ / 12CT'],
      ]) {
        await db.products.put({ ...cat(d), matchStatus: 'matched', matchMethod: 'rule90', priceItemId: line(b, l).id, suggestedPriceItemId: null });
      }
      await S.reload();
      expect(S.priceOf(cat('SMART WATER ALKLINE 1.5L 12CT').id)).toBe(2999);
      // decisions made by hand
      await S.confirmMatch(cat('SMART WATER ALKLINE 1L 12CT').id, line('SMART WATER', '1L / 12CT').id);
      await S.confirmMatch(cat('FIJI WATER 1L 2/6PK').id, line('FIJI WATER', '1.5L / 12CT').id);
      await S.leaveUnmatched(cat('CELSIUS DRAGONFRUIT LEMONADE 12OZ 1').id);
      // an order finalized with a 90%-rule price, and a cart holding it
      const store = await S.saveStore({ name: 'Corner Mart', address: '5 Elm St' });
      await S.selectStore(store.id);
      S.setQty(cat('SMART WATER ALKLINE 1.5L 12CT').id, 2);
      orderId = (await S.finalizeOrder(store.id)).id;
      S.setQty(cat('SMART WATER ALKLINE 1.5L 12CT').id, 3);
      S.setQty(cat('COKE 20OZ 24CT').id, 1);
      await S.flushDrafts();
    } finally {
      BUNDLED_DATASETS.push(...saved);
    }
    expect(await syncBundledData()).toEqual([5]);
    await S.reload();
    // hand decisions untouched
    expect(S.priceOf(cat('SMART WATER ALKLINE 1L 12CT').id)).toBe(1999);
    expect(cat('SMART WATER ALKLINE 1L 12CT').matchMethod).toBe('manual');
    expect(S.priceOf(cat('FIJI WATER 1L 2/6PK').id)).toBe(2549);
    expect(cat('CELSIUS DRAGONFRUIT LEMONADE 12OZ 1').matchStatus).toBe('unmatched');
    // 90%-rule prices that fail the new rules are taken back for review
    for (const d of ['SMART WATER ALKLINE 1.5L 12CT', 'CELSIUS VRTY PACK 12OZ 12CT']) {
      expect(cat(d).matchStatus).toBe('review');
      expect(S.priceOf(cat(d).id)).toBeNull();
    }
    // the finalized order keeps its value; the cart keeps its lines, the unverified one is now unpriced
    const o = (await S.getOrder(orderId))!;
    expect(o.lines.map((l) => [l.name, l.qty, l.priceCents])).toEqual([['SMART WATER ALKLINE 1.5L 12CT', 2, 2999]]);
    expect(S.currentLines().map((l) => l.qty)).toEqual([3, 1]);
    const t = S.cartTotals(S.currentLines());
    expect({ value: t.valueCents, unpriced: t.unpricedLines }).toEqual({ value: 3299, unpriced: 1 });
    expect(S.getState().settings.dataNotice?.text).toContain('2 prices were taken back for your confirmation');
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

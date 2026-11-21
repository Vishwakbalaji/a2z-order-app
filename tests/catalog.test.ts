import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { AppDB, useDb, db } from '../src/db/db';
import * as S from '../src/state/store';
import { BUNDLED_DATASETS, LATEST_BUNDLED_VERSION } from '../src/data/bundled';
import { A2Z_CATALOG_ROWS, splitDescription } from '../src/data/a2zCatalog';
import { OWNER_DOC_MATCHES } from '../src/data/ownerMatchedPrices';
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
    // owner verification policy (v5): 389 verified; plus 54 suggestions above 80% the owner accepted (v6)
    // + v7 (the owner's matched-prices list): 20 more priced, 7 he lists as NO PRICE → "Price not added"
    expect({ matched: by('matched'), review: by('review'), unmatched: by('unmatched') }).toEqual({ matched: 389 + 54 + 20 - 7, review: 8, unmatched: 78 });
    expect(catalog.filter((p) => p.matchMethod === 'rule90').length).toBe(0);
    expect(catalog.filter((p) => p.matchMethod === 'owner80').length).toBe(54 - 6); // 6 of them are NO PRICE in his list
    expect(catalog.filter((p) => p.matchMethod === 'ownerdoc').length).toBe(27);
    // his list, priced: each price is exactly the price-sheet line's price
    for (const [raw, , , cents] of OWNER_DOC_MATCHES) {
      expect(S.priceOf(cat(raw).id), raw).toBe(cents);
      expect(cat(raw).matchMethod, raw).toBe('ownerdoc');
    }
    expect(S.priceOf(cat('VITAMIN WATER ESSENTIAL-ORANGE 20OZ').id)).toBe(1999);
    expect(S.priceOf(cat('CANADA DRY CAN CRANBERRY 12OZ 24CT').id)).toBe(1299);
    // NO PRICE in his list → no price, even where the app had one before
    for (const d of ['FANTA MEXICO 355ML 24CT', 'FANTA GRAPE MEXICO 355ML 24CT', 'GATORADE FUTURE USE 20OZ 24CT', 'MAISON PERRIER GLASS 330ML 24PK', 'RED BULL VARIETY PK IVB WP CS 8.4OZ']) {
      expect(S.priceOf(cat(d).id), d).toBeNull();
      expect(cat(d).matchStatus, d).toBe('unmatched');
    }
    // prices in his list that the price sheet does not support are not applied
    expect(S.priceOf(cat('SAN PELLEGRINO GLASS 11OZ 24CT').id)).toBeNull();
    expect(S.priceOf(cat('SARATOGA SPARKLING GLASS 12OZ 24CT').id)).toBeNull();
    // products his list leaves out keep what they had
    expect(S.priceOf(cat('ACQUA PANNA 500 ML 24PK').id)).toBe(3099);
    expect(S.priceOf(cat('TROPICANA ORANGE 32OZ').id)).toBeNull();
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
    // suggestions above 80%: accepted by the owner (v6), counted as his confirmations
    const accepted: [string, number][] = [
      ['SMART WATER ALKLINE 1L 12CT', 1999],
      ['CELSIUS VRTY PACK 12OZ 12CT', 2049],
      ['FIJI WATER 1L 2/6PK', 2449], // was a 90%-rule link (ignored since v5): replaced by the owner's decision
      ['STARBUCKS COFFEE 13.7OZ 12CT', 3499],
      ['RED BULL 8.4OZ 24PK', 4099],
      ['CANADA DRY GINGER ALE 20OZ 24CT', 2599],
      ['ZEPHYRHILLS 16.9OZ 32CT', 699],
    ];
    for (const [d, price] of accepted) {
      expect(cat(d).matchMethod, d).toBe('owner80');
      expect(S.priceOf(cat(d).id), d).toBe(price);
    }
    // 80% and below: still waiting for the owner, without a price
    const flagged: [string, string][] = [
      ['CORE POWER 42GR STRAWBERRY ELITE 14', 'case count not shown'],
      ['TROPICANA PREMIUM LIVELY LEMONADE 1', 'Catalog does not show the size'],
      ['BODY ARMOUR TROPICCAL PASSION FRUIT', 'Catalog does not show the size'],
    ];
    for (const [d, why] of flagged) {
      expect(cat(d).matchStatus, d).toBe('review');
      expect(cat(d).matchScore, d).toBeLessThanOrEqual(0.8);
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
    expect(s.settings.dataNotice?.title).toBe('Your matched-prices list applied');
    expect(s.settings.dataNotice?.text).toContain('20 products added from your list, 7 marked "Price not added" as in your list. 456 of 542 catalog products are priced (coverage 84.1%); 86 show "Price not added".');
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
      BUNDLED_DATASETS.push(saved[0]); // v5 only; v6 below
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

    // v6: the owner accepts suggestions above 80% — never over his own decisions
    BUNDLED_DATASETS.push(...saved.slice(1));
    expect(await syncBundledData()).toEqual([6, 7]);
    await S.reload();
    expect(S.priceOf(cat('SMART WATER ALKLINE 1.5L 12CT').id)).toBe(2999);
    expect(cat('SMART WATER ALKLINE 1.5L 12CT').matchMethod).toBe('owner80');
    expect(cat('SMART WATER ALKLINE 1L 12CT').matchMethod).toBe('manual'); // his own confirmation stays
    expect(S.priceOf(cat('FIJI WATER 1L 2/6PK').id)).toBe(2549); // his hand-picked line, not the 80% suggestion
    expect(cat('FIJI WATER 1L 2/6PK').matchMethod).toBe('manual');
    expect(cat('CELSIUS DRAGONFRUIT LEMONADE 12OZ 1').matchStatus).toBe('unmatched');
    expect((await S.getOrder(orderId))!.lines[0].priceCents).toBe(2999);
    expect(S.cartTotals(S.currentLines()).valueCents).toBe(3299 + 3 * 2999); // the cart now uses the accepted price
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
    const sheetZeph = S.getState().products.find((p) => p.origin === 'pricesheet' && displayName(p) === 'SMART WATER 20OZ / 24CT')!;
    expect(S.getState().browseIds).toContain(sheetZeph.id); // not replaced: no catalog product uses this line
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
        { department: 'WATER', category: 'Smart Water', brand: 'Smart Water', name: 'SMART WATER', variation: '20OZ 24CT', unitsPerCase: 24, sku: '', raw: 'SMART WATER 20OZ 24CT' },
      ],
      mappings: [],
    });
    try {
      expect(await syncBundledData()).toEqual([LATEST_BUNDLED_VERSION + 1]);
      expect(await syncBundledData()).toEqual([]);
      await S.reload();
      const st = S.getState();
      const newZeph = cat('SMART WATER 20OZ 24CT');
      expect(S.priceOf(newZeph.id)).toBe(3099);
      expect(S.currentLines()).toEqual([{ productId: newZeph.id, qty: 4 }]); // cart now uses the catalog name
      expect(st.stores.map((x) => x.name)).toEqual(['Corner Mart']);
      const o = (await S.getOrder(order.id))!;
      expect(o.lines.map((l) => l.name)).toEqual(['SMART WATER 20OZ / 24CT', 'GATORADE COOL BLUE 20OZ 24PK']); // history unchanged
      expect(st.products.filter((p) => p.origin === 'catalog').length).toBe(543);
      expect(await db.priceItems.count()).toBe(131);
    } finally {
      BUNDLED_DATASETS.pop();
    }
  });
});

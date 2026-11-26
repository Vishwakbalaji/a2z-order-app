import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { AppDB, useDb, db } from '../src/db/db';
import * as S from '../src/state/store';
import { BUNDLED_DATASETS } from '../src/data/bundled';
import { SUPPLEMENT_ROWS } from '../src/data/supplementPrices';
import { syncBundledData } from '../src/db/importer';
import { displayName, priceInfo } from '../src/lib/products';

let n = 0;
async function fresh() {
  useDb(new AppDB(`supplement-${++n}`));
  await S.init();
  return S.getState();
}
const cat = (desc: string) => S.getState().products.find((p) => p.origin === 'catalog' && p.catalogName === desc)!;
const info = (desc: string) => S.priceInfoOf(cat(desc).id);

describe('owner price list A2Z_Mismatch_With_Prices (bundled v8)', () => {
  it('every row points at real catalog lines; red = confirmed, orange = approximate, grey = not listed', async () => {
    const later = BUNDLED_DATASETS.splice(8); // a phone with v1–v8 (v9 = his catalog notes, tested separately)
    let s!: Awaited<ReturnType<typeof fresh>>;
    try {
      s = await fresh();
    } finally {
      BUNDLED_DATASETS.push(...later);
    }
    const lines = new Set(s.products.filter((p) => p.origin === 'catalog').map((p) => p.catalogName));
    const used = new Set<string>();
    for (const r of SUPPLEMENT_ROWS) {
      expect(r.products.length, r.row).toBeGreaterThan(0);
      for (const l of r.products) {
        expect(lines.has(l), `${r.row} → ${l}`).toBe(true);
        expect(used.has(l), `${l} listed twice`).toBe(false); // one price row per product
        used.add(l);
        const i = info(l);
        if (r.color === 'grey') expect(i.status, l).toBe('none');
        else if (r.cents == null) expect(i.status, l).toBe(i.cents == null ? 'review' : r.color === 'red' ? 'confirmed' : 'approximate'); // choose / resolved by size
        else {
          expect(i.cents, l).toBe(r.cents);
          expect(i.status, l).toBe(r.color === 'red' ? 'confirmed' : 'approximate');
        }
      }
    }
    // totals over the whole catalog: every product has exactly one status
    const all = s.products.filter((p) => p.origin === 'catalog').map((p) => priceInfo(p, s.priceItemById).status);
    const c = { confirmed: 0, approximate: 0, review: 0, none: 0 };
    for (const st of all) c[st]++;
    expect(c).toEqual({ confirmed: 482, approximate: 44, review: 5, none: 11 });
    // multiple possible prices: never collapsed into one — the owner chooses
    for (const d of ['BODY ARMOUR TROPICCAL PASSION FRUIT', 'CANADA DRY GINGER ALE ZERO SUGAR 12OZ']) {
      const p = s.products.find((x) => x.catalogName?.startsWith(d.split(' ').slice(0, 3).join(' ')) && x.supplement?.status === 'select');
      if (p) {
        const i = priceInfo(p, s.priceItemById);
        expect(i.cents).toBeNull();
        expect(i.options!.length).toBeGreaterThanOrEqual(2);
      }
    }
    expect(s.products.filter((p) => p.supplement?.status === 'select').length).toBe(3);
    // Red Bull Amber: 8.4 oz per redbull.com → the 8 oz / 24 price ($40.99); orange in his list, so it stays approximate
    expect(info('RED BULL AMBER STRAWBERRY APPRICOT')).toMatchObject({ cents: 4099, status: 'approximate' });
    expect(displayName(cat('RED BULL AMBER STRAWBERRY APPRICOT'))).toContain('12 OZ / 24 CT'); // size from his corrected catalog
    // a safety copy was taken before applying
    expect((await db.snapshots.toArray()).some((x) => x.reason.includes('A2Z_Mismatch_With_Prices'))).toBe(true);
  });

  it('approximate prices count in totals but are marked; they turn green only when the owner confirms', async () => {
    await fresh();
    const store = await S.saveStore({ name: 'Corner Mart', address: '5 Elm St' });
    await S.selectStore(store.id);
    const orange = S.getState().products.find((p) => p.origin === 'catalog' && S.priceInfoOf(p.id).status === 'approximate')!;
    const green = cat('COKE DIET 20OZ 24CT');
    const none = cat('TOPO CHICO WATER 16.9OZ 18CT');
    const oc = S.priceInfoOf(orange.id).cents!;
    S.setQty(orange.id, 2);
    S.setQty(green.id, 1);
    S.setQty(none.id, 3);
    let t = S.cartTotals(S.currentLines());
    expect(t).toMatchObject({ valueCents: oc * 2 + 3299, approxLines: 1, unpricedLines: 1, unpricedCases: 3 }); // unpriced never counted as $0
    // finalized order stores the status with the line (snapshot)
    const o = await S.finalizeOrder(store.id);
    expect(o.lines.find((l) => l.productId === orange.id)!.priceStatus).toBe('approximate');
    expect(o.lines.find((l) => l.productId === green.id)!.priceStatus).toBeUndefined();
    // re-running the bundled updates never upgrades orange to green
    expect(await syncBundledData()).toEqual([]);
    await S.reload();
    expect(S.priceInfoOf(orange.id).status).toBe('approximate');
    // the owner confirms → green, same price; undo → orange again
    await S.confirmPrice(orange.id, oc);
    expect(S.priceInfoOf(orange.id)).toMatchObject({ cents: oc, status: 'confirmed', source: 'Confirmed by you' });
    S.setQty(orange.id, 1);
    t = S.cartTotals(S.currentLines());
    expect(t.approxLines).toBe(0);
    await S.undoPriceConfirmation(orange.id);
    expect(S.priceInfoOf(orange.id).status).toBe('approximate');
    // the completed order is unchanged
    expect((await S.getOrder(o.id))!.lines.find((l) => l.productId === orange.id)).toMatchObject({ priceCents: oc, priceStatus: 'approximate' });
  });

  it('a phone that already has v1–v7 keeps prices the owner entered by hand', async () => {
    const saved = BUNDLED_DATASETS.splice(7); // v8 not yet applied
    try {
      await fresh();
      const p = cat('ARIZONA CAN-GREEN TEA 22OZ 24CT');
      await S.saveProduct({ ...p, priceOverrideCents: 1999 });
      const before = await db.products.count();
      BUNDLED_DATASETS.push(saved[0]);
      expect(await syncBundledData()).toEqual([8]);
      await S.reload();
      expect(S.priceInfoOf(cat('ARIZONA CAN-GREEN TEA 22OZ 24CT').id)).toMatchObject({ cents: 1999, status: 'confirmed' }); // his price wins
      expect(info('ARIZONA CAN-LEMON ICE TEA 22OZ 24PK').status).toBe('approximate');
      expect(await db.products.count()).toBe(before); // nothing added or deleted
      expect(S.getState().settings.dataNotice?.title).toBe('New prices from your price list');
    } finally {
      BUNDLED_DATASETS.splice(7, BUNDLED_DATASETS.length - 7, ...saved);
    }
  });
});

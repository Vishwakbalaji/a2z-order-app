import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppDB, useDb, db } from '../src/db/db';
import * as S from '../src/state/store';
import { BUNDLED_DATASETS } from '../src/data/bundled';
import { catalogNoteRows, PRICE_NOTES, noteFor } from '../src/data/catalogPriceNotes';
import { A2Z_CATALOG_ROWS } from '../src/data/a2zCatalog';
import { syncBundledData } from '../src/db/importer';
import { priceInfo } from '../src/lib/products';

let n = 0;
async function fresh() {
  useDb(new AppDB(`notes-${++n}`));
  await S.init();
  return S.getState();
}
const cat = (desc: string) => S.getState().products.find((p) => p.origin === 'catalog' && p.catalogName === desc)!;
const info = (desc: string) => S.priceInfoOf(cat(desc).id);

describe("owner's price notes on the catalog PDF (bundled v9)", () => {
  // these tests describe the data up to v9; v10 (the corrected full catalog) is tested in correctedCatalog.test.ts
  let later: typeof BUNDLED_DATASETS = [];
  beforeEach(() => {
    later = BUNDLED_DATASETS.splice(9);
  });
  afterEach(() => {
    BUNDLED_DATASETS.push(...later);
  });
  it('a note line applies only when group, size, case count and multipack are identical', () => {
    expect(noteFor('COKE 20OZ 24CT', 'Coke')!.entry.cents).toBe(3299);
    expect(noteFor('FANTA STRAWBERRY 2L 1/8PK', 'Fanta')!.entry.cents).toBe(2150); // 1/8 = a case of 8
    expect(noteFor('MOUNTAIN DEW 2L 2-4PK', 'Mountain Dew')!.entry.label).toBe('2L 2-4PK');
    expect(noteFor('PEPSI 12 OZ 36CT', 'Pepsi')!.entry.cents).toBe(1499); // 36 stays 36
    expect(noteFor('CANADA DRY GINGER ALE CAN 12OZ 24CT', 'Canada Dry')!.entry.cents).toBe(1299); // loose 24, not 2 × 12
    expect(noteFor('SCHWEEPS Can 2/12', 'Schweeps')!.entry.label).toBe('2/12');
    expect(noteFor('GATORADE FIERCE GRAPE 28OZ 15CT', 'Gatorade')!.entry.cents).toBe(2999); // 15CT = 15PK
    expect(noteFor('SPRITE MEXICO 330ML 24CT', 'Sprite')).toBeNull(); // note says 355 ML only
    expect(noteFor('FANTA PINEAPPLE MEXICO 335ML 24CT', 'Fanta')).toBeNull();
    expect(noteFor('JARRITOS MANDARIN 12.5OZ 24CT', 'Jarritos')).toBeNull(); // groups without a note are not touched
    const groups = new Set(PRICE_NOTES.flatMap((x) => x.groups));
    const inGroups = A2Z_CATALOG_ROWS.filter(([, g]) => groups.has(g)).length;
    expect(inGroups).toBe(121);
    expect(catalogNoteRows().length).toBe(118); // + 2 single notes are among them; 3 Mexico 330/335 ML not covered
  });

  it('fresh phone: prices from the notes are confirmed; the rest keeps its status', async () => {
    const s = await fresh();
    for (const r of catalogNoteRows()) expect(info(r.products[0]), r.products[0]).toMatchObject({ cents: r.cents, status: 'confirmed' });
    expect(info('PEPSI 2L 8CT').cents).toBe(1399); // the price sheet says 21.50; his note says 13.99
    expect(info('CANADA DRY GINGER ALE ZERO SUGAR 2')).toMatchObject({ cents: 2599, status: 'confirmed' });
    expect(info('CANADA DRY TONIC WATER ZERO SUGAR 1')).toMatchObject({ cents: 2499, status: 'confirmed' });
    expect(info('GATORADE VARIETY PK 12OZ 24CT')).toMatchObject({ cents: 2399, status: 'confirmed' });
    expect(info('SPRITE MEXICO 330ML 24CT')).toMatchObject({ cents: 4099, status: 'approximate' });
    const c = { confirmed: 0, approximate: 0, review: 0, none: 0 };
    for (const p of s.products.filter((x) => x.origin === 'catalog')) c[priceInfo(p, s.priceItemById).status]++;
    expect(c).toEqual({ confirmed: 495, approximate: 34, review: 3, none: 10 }); // was 482 / 44 / 5 / 11
    expect(s.settings.dataNotice?.text).toContain('118 prices from your notes are confirmed (green).');
  });

  it('a phone that already has v8 keeps what the owner entered and chose in the app', async () => {
    const saved = BUNDLED_DATASETS.splice(8);
    try {
      await fresh();
      await S.confirmPrice(cat('CANADA DRY TONIC WATER ZERO SUGAR 1').id, 1299); // he chose the can price in the app
      const before = await db.products.count();
      BUNDLED_DATASETS.push(...saved);
      expect(await syncBundledData()).toEqual([9]);
      await S.reload();
      expect(info('CANADA DRY TONIC WATER ZERO SUGAR 1')).toMatchObject({ cents: 1299, status: 'confirmed', source: 'Confirmed by you' });
      expect(info('PEPSI 2L 8CT')).toMatchObject({ cents: 1399, status: 'confirmed' });
      expect(await db.products.count()).toBe(before);
      expect(S.getState().settings.dataNotice?.text).toContain('1 products you priced yourself were left as they are');
      expect((await db.snapshots.toArray()).some((x) => x.reason.includes('your price notes'))).toBe(true);
    } finally {
      BUNDLED_DATASETS.splice(8, BUNDLED_DATASETS.length - 8, ...saved);
    }
  });
});

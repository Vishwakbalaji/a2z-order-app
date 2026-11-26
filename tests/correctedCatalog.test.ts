import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AppDB, useDb, db } from '../src/db/db';
import * as S from '../src/state/store';
import { BUNDLED_DATASETS } from '../src/data/bundled';
import { CORRECTED_CATALOG } from '../src/data/correctedCatalog';
import { syncBundledData } from '../src/db/importer';
import { displayName } from '../src/lib/products';
import { search } from '../src/lib/search';

let n = 0;
async function fresh() {
  useDb(new AppDB(`corrected-${++n}`));
  await S.init();
  return S.getState();
}
const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toUpperCase();
const byName = (name: string) => S.getState().products.find((p) => p.listName === name)!;
const cat = (line: string) => S.getState().products.find((p) => p.origin === 'catalog' && p.catalogName === line)!;
const ROWS = CORRECTED_CATALOG.filter(([name], i, a) => a.findIndex(([x]) => x === name) === i);

describe("owner's corrected full catalog (bundled v10)", () => {
  it('the data is exactly the PDF: every name and price (green in the page, red in his added notes)', async () => {
    const data = new Uint8Array(fs.readFileSync(new URL('./fixtures/A2Z_Corrected_Full_Catalog.pdf', import.meta.url)));
    const doc = await getDocument({ data, verbosity: 0 }).promise;
    const texts: string[] = [];
    const notes: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      for (const it of (await page.getTextContent()).items as { str: string }[]) if (it.str.trim()) texts.push(norm(it.str));
      for (const a of (await page.getAnnotations()) as { subtype: string; contentsObj?: { str: string } }[]) if (a.subtype === 'FreeText') notes.push(a.contentsObj?.str || '');
    }
    expect(notes.sort()).toEqual(['$14.99', '$20.49', '$23.99', '$54.99', '$30.99', '12 OZ 24CT', '28 OZ'].sort());
    expect(CORRECTED_CATALOG.length).toBe(543); // 546 printed rows; 3 rows are printed twice
    const prices = texts.filter((t) => /^\$\d+\.\d\d$/.test(t));
    const green = CORRECTED_CATALOG.filter((r) => r[2] === 'green').map((r) => r[1]);
    const red = CORRECTED_CATALOG.filter((r) => r[2] === 'red').map((r) => `$${(r[1]! / 100).toFixed(2)}`);
    expect(red.sort()).toEqual(['$14.99', '$20.49', '$23.99', '$54.99', '$30.99'].sort());
    // every printed green price is in the data (3 duplicate rows printed twice)
    expect(prices.length).toBe(green.length + 3);
    for (const [name, , color] of CORRECTED_CATALOG) {
      const printed = color === 'red' && /\d+ OZ( 24CT)?$/.test(name) ? name.replace(/ (12 OZ 24CT|28 OZ)$/, '') : name;
      expect(texts, name).toContain(norm(printed));
    }
    expect(CORRECTED_CATALOG.filter((r) => r[1] == null).map((r) => r[0])).toEqual(['ARIZONA W/O PRICE VPK']);
  });

  it('fresh phone: names exactly as in the catalog, every price confirmed, blank stays blank, list = the catalog', async () => {
    const s = await fresh();
    const visible = s.browseIds.map((id) => s.productById.get(id)!);
    expect(visible.length).toBe(ROWS.length - 1); // "RED BULL 20OZ 12CT" and "…12PK" are one product
    for (const p of visible) expect(p.listName, p.id).toBeTruthy();
    for (const [name, cents] of ROWS) {
      if (name === 'RED BULL 20OZ 12PK') continue;
      const p = byName(name);
      expect(p, name).toBeTruthy();
      expect(displayName(p)).toBe(name);
      expect(S.priceInfoOf(p.id), name).toMatchObject(cents == null ? { cents: null, status: 'none' } : { cents, status: 'confirmed' });
    }
    expect(S.priceInfoOf(byName('PEPSI 2L 8CT').id).cents).toBe(2150);
    expect(S.priceInfoOf(byName('RED BULL AMBER STRAWBERRY APPRICOT 12 OZ 24CT').id).cents).toBe(5499);
    expect(S.priceInfoOf(byName('BODY ARMOUR TROPICCAL PASSION FRUIT 28 OZ').id).cents).toBe(3099);
    expect(S.priceInfoOf(byName('TROPICANA ORANGE 32OZ').id)).toMatchObject({ cents: 2399, status: 'confirmed' });
    // 8 new Saratoga lines; products not in this catalog are hidden, not deleted
    expect(visible.filter((p) => p.category === 'Saratoga').map((p) => p.listName)).toHaveLength(8);
    for (const line of ['TOPO CHICO WATER 16.9OZ 18CT', 'SARATOGA STILL WATER 12OZ 24CT']) {
      expect(cat(line).missingFromCatalog, line).toBe(true);
      expect(s.browseIds).not.toContain(cat(line).id);
    }
    expect(visible.filter((p) => p.origin === 'pricesheet')).toHaveLength(0);
    const c = { confirmed: 0, approximate: 0, review: 0, none: 0 };
    for (const p of visible) c[S.priceInfoOf(p.id).status]++;
    expect(c).toEqual({ confirmed: 541, approximate: 0, review: 0, none: 1 });
    // searching by the catalog names
    const names = (q: string) => search(q, s.browseIds, s.index).map((id) => displayName(s.productById.get(id)!));
    expect(names('coke vanila 20')).toContain('COKE VANILA 20 OZ 24CT');
    expect(names('saratoga sparkling glass')).toEqual(expect.arrayContaining(['SARATOGA SPARKLING 12OZ 12CT GLASS', 'SARATOGA SPARKLING 28OZ 12CT GLASS']));
    expect(s.settings.dataNotice?.title).toBe('Your corrected catalog applied');
  });

  it('a phone with data: stores, carts and orders kept; a different price typed earlier follows the catalog; hidden products can be shown again', async () => {
    const later = BUNDLED_DATASETS.splice(9); // the phone has v1–v9
    try {
      await fresh();
      const store = await S.saveStore({ name: 'Corner Mart', address: '5 Elm St' });
      await S.selectStore(store.id);
      S.setQty(cat('COKE 20OZ 24CT').id, 2);
      const order = await S.finalizeOrder(store.id);
      S.setQty(cat('TOPO CHICO WATER 16.9OZ 18CT').id, 1);
      S.setQty(cat('PEPSI 2L 8CT').id, 3);
      await S.flushDrafts();
      await S.confirmPrice(cat('MONSTER JAVA VRTY 16OZ 12CT').id, 1111); // typed in the app; the catalog says 38.50
      await S.saveProduct({ ...cat('ARIZONA W/O PRICE VPK'), priceOverrideCents: 1999 }); // his own price for the blank row
      const before = await db.products.count();
      BUNDLED_DATASETS.push(...later);
      expect(await syncBundledData()).toEqual([10]);
      await S.reload();
      const st = S.getState();
      expect(st.stores.map((x) => x.name)).toEqual(['Corner Mart']);
      expect((await S.getOrder(order.id))!.lines.map((l) => [l.name, l.priceCents])).toEqual([['COKE — 20 OZ / 24 CT', 3299]]); // unchanged
      expect(S.currentLines().map((l) => l.qty)).toEqual([1, 3]); // cart kept, incl. the hidden Topo Chico
      expect(S.cartTotals(S.currentLines())).toMatchObject({ valueCents: 3 * 2150, unpricedLines: 1 });
      expect(S.priceInfoOf(cat('MONSTER JAVA VRTY 16OZ 12CT').id)).toMatchObject({ cents: 3850, status: 'confirmed' });
      expect(S.priceInfoOf(cat('ARIZONA W/O PRICE VPK').id)).toMatchObject({ cents: 1999, status: 'confirmed' }); // kept
      expect(st.settings.dataNotice?.text).toContain('MONSTER JAVA VRTY 16OZ 12CT $11.11 → $38.50');
      expect(await db.products.count()).toBe(before + 8); // nothing deleted
      expect((await db.snapshots.toArray()).some((x) => x.reason.includes('corrected catalog'))).toBe(true);
      // Manage products › "Show in product list"
      const topo = cat('TOPO CHICO WATER 16.9OZ 18CT');
      await S.saveProduct({ ...topo, missingFromCatalog: false });
      expect(S.getState().browseIds).toContain(topo.id);
      expect(await syncBundledData()).toEqual([]); // applied once
    } finally {
      BUNDLED_DATASETS.splice(9, BUNDLED_DATASETS.length - 9, ...later);
    }
  });
});

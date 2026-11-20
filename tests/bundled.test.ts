import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { AppDB, useDb, db } from '../src/db/db';
import * as S from '../src/state/store';
import { BUNDLED_DATASETS } from '../src/data/bundled';
import { syncBundledData } from '../src/db/importer';
import { displayName } from '../src/lib/products';

describe('bundled data updates (future catalog shipped with an app update)', () => {
  it('applies new bundled datasets once, renames via the catalog, and keeps stores/carts/orders', async () => {
    useDb(new AppDB('bundled-1'));
    await S.init();
    expect(S.getState().settings.bundledVersion).toBe(1);
    // the phone is in use
    const store = await S.saveStore({ name: 'Corner Mart', address: '5 Elm St' });
    await S.selectStore(store.id);
    const evianSheet = S.getState().products.find((p) => displayName(p) === 'EVIAN WATER 500ML / 24CT')!;
    S.setQty(evianSheet.id, 3);
    await S.flushDrafts();
    const gator = S.getState().products.find((p) => displayName(p) === 'GATORADE 20OZ / 24CT')!;
    S.setQty(gator.id, 1);
    const order = await S.finalizeOrder(store.id);
    S.setQty(evianSheet.id, 3);
    await S.flushDrafts();

    // an app update ships the catalog as bundled version 2
    BUNDLED_DATASETS.push({
      version: 2,
      kind: 'catalog',
      fileName: 'A2Z_Catalog.pdf',
      rows: [
        { department: 'WATER', category: 'Spring Water', brand: 'Evian', name: 'Natural Spring Water', variation: '500ML / 24CT', unitsPerCase: 24, sku: '', raw: 'Evian Natural Spring Water 500ML 24PK' },
        { department: 'WATER', category: 'Sparkling', brand: 'Saratoga', name: 'Sparkling Spring Water', variation: '28OZ / 12CT', unitsPerCase: 12, sku: '', raw: 'Saratoga Sparkling Spring Water 28OZ 12PK' },
        { department: 'SODA', category: 'Cola', brand: 'Coca-Cola', name: 'Classic', variation: '20OZ / 24CT', unitsPerCase: 24, sku: '', raw: 'Coca-Cola Classic 20OZ 24PK' },
      ],
      // verified by a person: the Saratoga catalog item is the SPARKLING 28OZ line
      mappings: [{ catalogRaw: 'Saratoga Sparkling Spring Water 28OZ 12PK', priceBrand: 'SARATOGA WATER', priceDesc: 'SPARKLING 28OZ / 12CT' }],
    });
    try {
      expect(await syncBundledData()).toEqual([2]);
      expect(await syncBundledData()).toEqual([]); // only once
      await S.reload();
      const st = S.getState();
      expect(st.settings.bundledVersion).toBe(2);
      const cat = (raw: string) => st.products.find((p) => p.catalogName === raw)!;
      expect(S.priceOf(cat('Evian Natural Spring Water 500ML 24PK').id)).toBe(2299);
      expect(S.priceOf(cat('Saratoga Sparkling Spring Water 28OZ 12PK').id)).toBe(2449);
      expect(cat('Saratoga Sparkling Spring Water 28OZ 12PK').matchMethod).toBe('manual');
      expect(S.priceOf(cat('Coca-Cola Classic 20OZ 24PK').id)).toBe(3299);
      // catalog names replace the price-sheet names in the product list
      expect(st.browseIds).not.toContain(evianSheet.id);
      expect(st.browseIds).toContain(cat('Evian Natural Spring Water 500ML 24PK').id);
      // user data untouched
      expect(st.stores.map((s) => s.name)).toEqual(['Corner Mart']);
      expect(S.currentLines()).toEqual([{ productId: cat('Evian Natural Spring Water 500ML 24PK').id, qty: 3 }]); // cart moved to the catalog name
      expect(S.cartTotals(S.currentLines()).valueCents).toBe(6897);
      expect((await S.getOrder(order.id))!.lines.map((l) => l.name)).toEqual(['EVIAN WATER 500ML / 24CT', 'GATORADE 20OZ / 24CT']); // history unchanged
      expect(await db.priceItems.count()).toBe(131);
    } finally {
      BUNDLED_DATASETS.pop();
    }
  });
});

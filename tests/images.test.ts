import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { AppDB, useDb, db } from '../src/db/db';
import * as S from '../src/state/store';
import { PRODUCT_IMAGES } from '../src/data/productImages';
import { imageCounts, imageState, resolveImage } from '../src/lib/images';
import { exportBackup } from '../src/db/backup';
import type { ProductImageOverride } from '../src/types';

const entry = (status: 'verified' | 'approx' | 'review') => ({ file: 'x.webp', name: 'X', status, confidence: 98, source: 'Open Food Facts', sourceUrl: 'https://world.openfoodfacts.org/product/1', credit: 'c', license: 'CC BY-SA 3.0', verifiedAt: '2026-11-21' });

describe('product pictures', () => {
  it('shows verified/approximate pictures, hides ones that need review, and the owner always wins', () => {
    const saved = { ...PRODUCT_IMAGES };
    try {
      PRODUCT_IMAGES['t_v'] = { ...entry('verified'), file: 't_v.webp' };
      PRODUCT_IMAGES['t_a'] = { ...entry('approx'), file: 't_a.webp' };
      PRODUCT_IMAGES['t_r'] = { ...entry('review'), file: 't_r.webp' };
      const none = new Map<string, ProductImageOverride>();
      expect(resolveImage({ id: 't_v' }, none)?.thumb).toMatch(/products\/t\/t_v\.webp$/);
      expect(resolveImage({ id: 't_v' }, none)?.large).toMatch(/products\/l\/t_v\.webp$/);
      expect(resolveImage({ id: 't_a' }, none)?.kind).toBe('approx');
      expect(resolveImage({ id: 't_r' }, none)).toBeNull(); // not shown until approved
      expect(resolveImage({ id: 'nothing' }, none)).toBeNull();
      const o = (id: string, status: ProductImageOverride['status'], dataUrl: string | null = null) => [id, { id, status, dataUrl, catalogName: id, updatedAt: 1 }] as const;
      const mine = new Map<string, ProductImageOverride>([o('t_v', 'rejected'), o('t_r', 'approved'), o('nothing', 'manual', 'data:image/webp;base64,AAA')]);
      expect(resolveImage({ id: 't_v' }, mine)).toBeNull();
      expect(resolveImage({ id: 't_r' }, mine)?.kind).toBe('approved');
      expect(resolveImage({ id: 'nothing' }, mine)?.thumb).toBe('data:image/webp;base64,AAA');
      expect(imageState({ id: 't_v' }, mine)).toBe('rejected');
      const c = imageCounts([{ id: 't_v' }, { id: 't_a' }, { id: 't_r' }, { id: 'nothing' }, { id: 'other' }], none);
      expect(c).toMatchObject({ total: 5, verified: 1, approx: 1, review: 1, none: 2, coverage: 40 }); // review is not coverage
    } finally {
      for (const k of Object.keys(PRODUCT_IMAGES)) delete PRODUCT_IMAGES[k];
      Object.assign(PRODUCT_IMAGES, saved);
    }
  });

  it('every shipped picture belongs to a real catalog product id and has its files', async () => {
    useDb(new AppDB('images-ids'));
    await S.init();
    const ids = new Set(S.getState().products.filter((p) => p.origin === 'catalog').map((p) => p.id));
    const fs = await import('node:fs');
    for (const [id, e] of Object.entries(PRODUCT_IMAGES)) {
      expect(ids.has(id), `${e.name} (${id})`).toBe(true);
      expect(S.getState().productById.get(id)!.catalogName).toBe(e.name);
      for (const d of ['t', 'l']) expect(fs.existsSync(new URL(`../public/products/${d}/${e.file}`, import.meta.url)), `${d}/${e.file}`).toBe(true);
      expect(['verified', 'approx', 'review']).toContain(e.status);
      if (e.status !== 'review') expect(e.confidence).toBeGreaterThanOrEqual(95);
    }
  });

  it('phones whose catalog products have older random ids still get the right picture (exact catalog line)', async () => {
    useDb(new AppDB('images-old-ids'));
    await S.init();
    const [id, e] = Object.entries(PRODUCT_IMAGES).find(([, x]) => x.status !== 'review')!;
    const p = S.getState().productById.get(id)!;
    // same product as created before permanent ids existed: random id, same catalog text
    const old = { ...p, id: 'p_m1x9old42', catalogName: `  ${p.catalogName.toLowerCase()} ` };
    expect(resolveImage(old, new Map())?.thumb).toMatch(new RegExp(`products/t/${e.file}$`));
    // a different product never borrows it, and price-sheet products are never matched by text
    expect(resolveImage({ ...old, catalogName: `${p.catalogName} X` }, new Map())).toBeNull();
    expect(resolveImage({ ...old, origin: 'pricesheet' }, new Map())).toBeNull();
    // the owner's decision is stored under the id his phone uses
    expect(resolveImage(old, new Map([[old.id, { id: old.id, status: 'rejected', catalogName: p.catalogName, updatedAt: 1 }]]))).toBeNull();
  });

  it("the owner's decisions are saved, survive a reload and are in backups", async () => {
    useDb(new AppDB('images-owner'));
    await S.init();
    const p = S.getState().products.find((x) => x.origin === 'catalog')!;
    await S.setProductImage(p, 'manual', 'data:image/webp;base64,BBB');
    await S.reload();
    expect(S.getState().imageOverrides.get(p.id)?.dataUrl).toBe('data:image/webp;base64,BBB');
    expect((await exportBackup()).tables.productImages).toHaveLength(1);
    expect(await db.syncOutbox.where('k').startsWith('productImages').count()).toBe(1); // queued for cloud sync
    await S.clearProductImage(p.id);
    expect(S.getState().imageOverrides.has(p.id)).toBe(false);
  });
});

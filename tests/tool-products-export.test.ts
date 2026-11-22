// Tool (skipped unless OUT is set): OUT=/path/products.json npx vitest run tests/tool-products-export.test.ts
// Exports every active catalog product (stable product id, name, brand group, size, case count) — used to
// look up product images.
import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { it } from 'vitest';
import { AppDB, useDb } from '../src/db/db';
import * as S from '../src/state/store';
import { parsePack, parseSize } from '../src/lib/normalize';
import { canon, catalogText } from '../src/lib/matching';

it.skipIf(!process.env.OUT)('export', async () => {
  useDb(new AppDB('export'));
  await S.init();
  const s = S.getState();
  const rows = s.products
    .filter((p) => p.origin === 'catalog' && p.active)
    .map((p) => {
      const t = canon(catalogText(p));
      const sz = parseSize(t);
      return { id: p.id, name: p.catalogName, dept: p.department, group: p.category, brand: p.brand, size: sz?.label ?? '', ml: sz?.ml ?? null, grams: sz?.grams ?? null, count: parsePack(t)?.units ?? p.unitsPerCase ?? null };
    });
  fs.writeFileSync(process.env.OUT!, JSON.stringify(rows, null, 1));
});

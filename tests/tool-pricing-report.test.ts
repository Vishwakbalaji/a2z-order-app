// Tool (skipped unless OUT is set): OUT=/path/pricing.json npx vitest run tests/tool-pricing-report.test.ts
// Applies every bundled update on a fresh phone and writes each catalog product's price, status and source.
import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { it } from 'vitest';
import { AppDB, useDb } from '../src/db/db';
import * as S from '../src/state/store';
import { displayName } from '../src/lib/products';
import { SUPPLEMENT_ROWS } from '../src/data/supplementPrices';
import { normText } from '../src/lib/normalize';

it.skipIf(!process.env.OUT)('pricing report', async () => {
  useDb(new AppDB('pricing-report'));
  await S.init();
  const s = S.getState();
  const catalog = s.products.filter((p) => p.origin === 'catalog' && p.active);
  const lines = new Set(catalog.map((p) => normText(p.catalogName)));
  const missing = SUPPLEMENT_ROWS.flatMap((r) => r.products).filter((l) => !lines.has(normText(l)));
  const rows = catalog.map((p) => {
    const i = S.priceInfoOf(p.id);
    return { id: p.id, catalog: p.catalogName, name: displayName(p), group: p.category, cents: i.cents, status: i.status, source: i.source, options: i.options, note: p.supplement?.note ?? null };
  });
  fs.writeFileSync(process.env.OUT!, JSON.stringify({ notice: s.settings.dataNotice, missing, rows }, null, 1));
});

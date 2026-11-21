// Tool (skipped unless OUT is set): OUT=/path/unpriced.json npx vitest run tests/tool-unpriced.test.ts
// Lists every catalog product that has no price after all bundled updates (with brand, size, closest line).
import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { it } from 'vitest';
import { AppDB, useDb } from '../src/db/db';
import * as S from '../src/state/store';
import { parseSize } from '../src/lib/normalize';
import { canon, catalogText } from '../src/lib/matching';

it.skipIf(!process.env.OUT)('unpriced', async () => {
  useDb(new AppDB('unpriced'));
  await S.init();
  const s = S.getState();
  const rows = s.products
    .filter((p) => p.origin === 'catalog' && p.active && S.priceOf(p.id) == null)
    .map((p) => {
      const sz = parseSize(canon(catalogText(p)));
      const sug = p.suggestedPriceItemId ? s.priceItemById.get(p.suggestedPriceItemId) : undefined;
      return {
        dept: p.department,
        group: p.category,
        size: sz?.label ?? '',
        name: p.catalogName,
        status: p.matchStatus,
        conf: Math.round(p.matchScore * 100),
        line: sug ? `${sug.brand} ${sug.desc} $${(sug.priceCents / 100).toFixed(2)}` : '',
        why: (p.matchFlags || []).join('; '),
      };
    });
  fs.writeFileSync(process.env.OUT!, JSON.stringify(rows, null, 1));
});

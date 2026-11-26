// Tool (skipped unless OUT is set): products without a confirmed price, by section → price-sheet brand heading.
// OUT=/path/list.txt npx vitest run tests/tool-unconfirmed.test.ts
import 'fake-indexeddb/auto';
import { it } from 'vitest';
import fs from 'node:fs';
import { AppDB, useDb } from '../src/db/db';
import * as S from '../src/state/store';
import { sizeLabel, titleName } from '../src/lib/products';

it.skipIf(!process.env.OUT)('list of products without a confirmed price, by category', async () => {
  useDb(new AppDB('tool-unconfirmed'));
  await S.init();
  const s = S.getState();
  const out: string[] = [];
  let n = 0;
  let lastD = '';
  let lastS = '';
  const $ = (c: number) => `$${(c / 100).toFixed(2)}`;
  for (const id of s.browseIds) {
    const p = s.productById.get(id)!;
    const i = s.priceInfoById.get(id)!;
    if (p.origin === 'pricesheet' || i.status === 'confirmed') continue;
    const d = p.department || 'Other';
    const sb = s.subOf.get(id)!;
    if (d !== lastD) (out.push(`\n## ${d}`), (lastD = d), (lastS = ''));
    if (sb !== lastS) (out.push(`### ${sb}`), (lastS = sb));
    const st =
      i.status === 'approximate'
        ? `orange ${$(i.cents!)}`
        : i.status === 'review'
          ? i.options?.length
            ? 'choose: ' + i.options.map((o) => `${$(o.cents)} ${o.label}`).join(' or ')
            : `needs review${i.suggestion ? ` (suggested ${$(i.suggestion)})` : ''}`
          : 'no price';
    out.push(`${++n}. ${titleName(p)} | ${sizeLabel(p) || '(size/count not shown)'} | ${st} | ${p.supplement?.note || p.supplement?.sheetRef || i.source}`);
  }
  fs.writeFileSync(process.env.OUT!, out.join('\n'));
});

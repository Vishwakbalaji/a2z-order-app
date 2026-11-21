// Tool (skipped unless OUT is set): OUT=/path/report.txt npx vitest run tests/tool-match-report.test.ts — full catalog vs price sheet matching report
import fs from 'node:fs';
import { it } from 'vitest';
import { A2Z_CATALOG_ROWS, splitDescription, brandForGroup } from '../src/data/a2zCatalog';
import { A2Z_PRICE_ROWS } from '../src/data/a2zPriceSheet';
import { matchProduct } from '../src/lib/matching';
import { priceItemKey, unitsFromText } from '../src/lib/products';
import { parseMoneyToCents } from '../src/lib/money';
import type { PriceItem } from '../src/types';

it.skipIf(!process.env.OUT)('report', () => {
  const items: PriceItem[] = A2Z_PRICE_ROWS.map(([section, brand, desc, price], i) => ({
    id: 'pi' + i, key: priceItemKey(brand, desc), section, brand, desc, sku: '', priceCents: parseMoneyToCents(price)!,
    prevPriceCents: null, raw: '', sourceFile: '', importedAt: 0, missingFromLatest: false, order: i,
  }));
  const byId = new Map(items.map((i) => [i.id, i]));
  const lines: string[] = [];
  const counts = { matched: 0, review: 0, unmatched: 0 };
  for (const [dept, group, desc] of A2Z_CATALOG_ROWS) {
    const { name, variation } = splitDescription(desc);
    const p = { brand: brandForGroup(group, desc), name, variation, sku: '', unitsPerCase: unitsFromText(desc), catalogName: desc };
    const r = matchProduct(p, items, new Map());
    counts[r.status]++;
    const it = byId.get(r.priceItemId || r.suggestedPriceItemId || '');
    const reasons = r.candidates.find((c) => c.item.id === it?.id)?.reasons.join('; ') || '';
    lines.push([r.status.toUpperCase().padEnd(9), dept.slice(0, 6).padEnd(6), group.padEnd(14), desc.padEnd(38), it ? `-> ${it.brand} ${it.desc} $${(it.priceCents / 100).toFixed(2)}` : '', r.status === 'matched' ? '' : `[${Math.round(r.score * 100)}%] ${reasons}`].join(' | '));
  }
  fs.writeFileSync(process.env.OUT!, JSON.stringify(counts) + '\n' + lines.join('\n'));
});

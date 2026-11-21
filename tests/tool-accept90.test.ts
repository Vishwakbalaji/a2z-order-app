// Tool (skipped unless OUT is set): list catalog suggestions scoring >= 90% (as shown in the app)
import fs from 'node:fs';
import { it } from 'vitest';
import { A2Z_CATALOG_ROWS, splitDescription, brandForGroup } from '../src/data/a2zCatalog';
import { A2Z_PRICE_ROWS } from '../src/data/a2zPriceSheet';
import { matchProduct } from '../src/lib/matching';
import { priceItemKey, unitsFromText } from '../src/lib/products';
import { parseMoneyToCents } from '../src/lib/money';
import type { PriceItem } from '../src/types';

it.skipIf(!process.env.OUT)('accept90', () => {
  const items: PriceItem[] = A2Z_PRICE_ROWS.map(([section, brand, desc, price], i) => ({
    id: 'pi' + i, key: priceItemKey(brand, desc), section, brand, desc, sku: '', priceCents: parseMoneyToCents(price)!,
    prevPriceCents: null, raw: '', sourceFile: '', importedAt: 0, missingFromLatest: false, order: i,
  }));
  const out: [string, string, string, number][] = [];
  const seen = new Set<string>();
  for (const [, group, desc] of A2Z_CATALOG_ROWS) {
    if (seen.has(desc)) continue;
    seen.add(desc);
    const { name, variation } = splitDescription(desc);
    const r = matchProduct({ brand: brandForGroup(group, desc), name, variation, sku: '', unitsPerCase: group === 'Plastic bags' ? null : unitsFromText(desc), catalogName: desc }, items, new Map());
    if (r.status === 'review' && Math.round(r.score * 100) >= 90) {
      const it = items.find((i) => i.id === r.suggestedPriceItemId)!;
      out.push([desc, it.brand, it.desc, Math.round(r.score * 100)]);
    }
  }
  fs.writeFileSync(process.env.OUT!, JSON.stringify(out));
});

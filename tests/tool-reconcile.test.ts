// Tool (skipped unless ROWS and OUT are set):
//   ROWS=/path/rows.json OUT=/path/reconcile.json npx vitest run tests/tool-reconcile.test.ts
// Checks the owner's "A2Z_Catalog_Matched_Prices.pdf" (rows parsed from its text layer) against the price
// sheet and against the app's current prices (all bundled updates applied).
import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { it } from 'vitest';
import { AppDB, useDb } from '../src/db/db';
import * as S from '../src/state/store';
import { parsePack, parseSize, normText, tokens } from '../src/lib/normalize';
import { canon, compareSize } from '../src/lib/matching';
import { parseMoneyToCents } from '../src/lib/money';

interface Row { n: number; page: number; catalog: string; price: string; listing: string; quality: string }

it.skipIf(!process.env.ROWS || !process.env.OUT)('reconcile', async () => {
  const rows: Row[] = JSON.parse(fs.readFileSync(process.env.ROWS!, 'utf8'));
  useDb(new AppDB('reconcile'));
  await S.init();
  const s = S.getState();
  const catalog = s.products.filter((p) => p.origin === 'catalog' && p.active);
  const byName = new Map(catalog.map((p) => [normText(p.catalogName), p]));
  const label = (id?: string | null) => {
    const it = id ? s.priceItemById.get(id) : undefined;
    return it ? `${it.brand} ${it.desc}` : '';
  };
  const out = rows.map((r) => {
    const p = byName.get(normText(r.catalog));
    const docCents = r.price === 'NO PRICE' ? null : parseMoneyToCents(r.price.replace('$', ''));
    let lineId: string | null = null;
    let lineProblem = '';
    if (docCents != null) {
      const listing = r.listing.replace(/\[p\d\]/g, '').trim();
      const [lb, ld = ''] = listing.split(' - ');
      const lt = canon(listing);
      const ls = parseSize(lt), lp = parsePack(lt);
      const brandWords = tokens(canon(lb)).filter((w) => w.length > 1);
      const cands = s.priceItems.filter((it) => {
        const t = canon(`${it.brand} ${it.desc}`);
        const sizeOk = !ls || compareSize(ls, parseSize(t)).rel === 'exact';
        const packOk = !lp || parsePack(t)?.units === lp.units;
        const brandOk = brandWords.some((w) => tokens(t).includes(w)) || tokens(t).some((w) => brandWords.includes(w));
        return sizeOk && packOk && brandOk;
      });
      const samePrice = cands.filter((c) => c.priceCents === docCents);
      if (samePrice.length === 1) lineId = samePrice[0].id;
      else if (samePrice.length > 1) lineProblem = `several lines fit: ${samePrice.map((c) => `${c.brand} ${c.desc}`).join(' / ')}`;
      else lineProblem = cands.length ? `price differs from the price sheet: ${cands.map((c) => `${c.brand} ${c.desc} $${(c.priceCents / 100).toFixed(2)}`).join(' / ')}` : `listing "${listing}" not found on the price sheet` + (ld ? '' : '');
    }
    const cur = p ? S.priceOf(p.id) : null;
    return {
      n: r.n, catalog: r.catalog, found: !!p, productId: p?.id ?? null,
      doc: { cents: docCents, listing: r.listing, quality: r.quality, lineId, line: label(lineId), lineBrand: lineId ? s.priceItemById.get(lineId)!.brand : null, lineDesc: lineId ? s.priceItemById.get(lineId)!.desc : null, lineProblem },
      app: p ? { cents: cur, status: p.matchStatus, method: p.matchMethod, line: label(p.priceItemId), suggested: label(p.suggestedPriceItemId), override: p.priceOverrideCents } : null,
    };
  });
  const docNames = new Set(rows.map((r) => normText(r.catalog)));
  const missingFromDoc = catalog.filter((p) => !docNames.has(normText(p.catalogName))).map((p) => ({ catalog: p.catalogName, cents: S.priceOf(p.id), status: p.matchStatus, line: label(p.priceItemId) }));
  fs.writeFileSync(process.env.OUT!, JSON.stringify({ rows: out, missingFromDoc }, null, 1));
});

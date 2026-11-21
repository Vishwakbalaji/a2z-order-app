// Tool (skipped unless OUT is set): OUT=/path/audit npx vitest run tests/tool-audit.test.ts
// Full 3-pass pricing audit of the bundled catalog against the bundled price sheet (and the original PDF).
// Writes OUT.json (every product) and OUT.md (summary, corrections, review table).
import fs from 'node:fs';
import { it } from 'vitest';
import { A2Z_CATALOG_ROWS, splitDescription, brandForGroup } from '../src/data/a2zCatalog';
import { A2Z_PRICE_ROWS } from '../src/data/a2zPriceSheet';
import { ACCEPTED_90 } from '../src/data/acceptedMatches';
import { matchProduct, buildSiblingCounts, type MatchContext } from '../src/lib/matching';
import { matchProduct as oldMatch } from './fixtures/matchingV4';
import { priceItemKey, unitsFromText } from '../src/lib/products';
import { parseMoneyToCents } from '../src/lib/money';
import { parsePriceSheet } from '../src/lib/pdf/priceSheetParser';
import { loadPdfPages } from './pdfNode';
import type { PriceItem } from '../src/types';

const $ = (c: number) => `$${(c / 100).toFixed(2)}`;

it.skipIf(!process.env.OUT)('audit', async () => {
  const items: PriceItem[] = A2Z_PRICE_ROWS.map(([section, brand, desc, price], i) => ({
    id: 'pi' + i, key: priceItemKey(brand, desc), section, brand, desc, sku: '', priceCents: parseMoneyToCents(price)!,
    prevPriceCents: null, raw: '', sourceFile: '', importedAt: 0, missingFromLatest: false, order: i,
  }));
  const byId = new Map(items.map((i) => [i.id, i]));
  const label = (i?: PriceItem) => (i ? `${i.brand} ${i.desc}` : '');

  // Pass 3a: every price line against the original PDF (independent parse)
  const pages = await loadPdfPages(new URL('./fixtures/A2Z_Beverages_Price_Deals_A4_2.pdf', import.meta.url).pathname);
  const parsed = parsePriceSheet(pages).rows;
  const pdfMismatch: string[] = [];
  for (const it of items) {
    const hits = parsed.filter((r) => r.brand === it.brand && r.desc === it.desc);
    if (hits.length !== 1 || hits[0].priceCents !== it.priceCents) pdfMismatch.push(`${label(it)}: app ${$(it.priceCents)}, PDF ${hits.map((h) => $(h.priceCents)).join('/') || 'missing'}`);
  }
  const dupKeys = items.filter((it, i) => items.findIndex((o) => o.key === it.key) !== i).map(label);

  // the catalog as products (de-duplicated like the app: the RED BULL 20OZ 12CT/12PK pair)
  const seen = new Set<string>();
  const products = A2Z_CATALOG_ROWS.flatMap(([dept, group, desc]) => {
    const { name, variation } = splitDescription(desc);
    const p = { dept, category: group, brand: brandForGroup(group, desc), name, variation, sku: '', unitsPerCase: group === 'Plastic bags' ? null : unitsFromText(desc), catalogName: desc };
    if (desc === 'RED BULL 20OZ 12PK') return [];
    if (seen.has(desc)) return [];
    seen.add(desc);
    return [p];
  });
  const ctx: MatchContext = { brandLevelFlavors: process.env.STRICT_FLAVORS ? false : true, siblings: buildSiblingCounts(products) };
  const acc = new Map(ACCEPTED_90.map(([raw, b, d]) => [raw, items.find((i) => i.brand === b && i.desc === d)!]));

  const rows = products.map((p) => {
    const o = oldMatch(p, items, new Map());
    const oldItem = acc.get(p.catalogName) ?? (o.status === 'matched' ? byId.get(o.priceItemId!) : undefined);
    const oldStatus = acc.has(p.catalogName) ? 'rule90' : o.status;
    const r = matchProduct(p, items, new Map(), ctx);
    const best = r.candidates[0];
    const it = byId.get(r.priceItemId || r.suggestedPriceItemId || '');
    return {
      dept: p.dept, group: p.category, catalog: p.catalogName,
      old: { status: oldStatus, line: label(oldItem), price: oldItem?.priceCents ?? null },
      new: { status: r.status, verdict: best?.verdict ?? 'none', line: label(it), price: it?.priceCents ?? null, confidence: r.confidence, basis: r.basis, flags: r.flags, notes: r.notes },
      others: r.candidates.slice(1, 3).map((c) => `${label(c.item)} (${c.confidence})`),
    };
  });

  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const total = rows.length;
  const verified = count((r) => r.new.status === 'matched');
  const suggested = count((r) => r.new.status === 'review');
  const unmatched = count((r) => r.new.status === 'unmatched');
  const changedLine = rows.filter((r) => r.old.price != null && r.new.status === 'matched' && r.new.line !== r.old.line);
  const demoted = rows.filter((r) => r.old.price != null && r.new.status !== 'matched');
  const promoted = rows.filter((r) => r.old.price == null && r.new.status === 'matched');
  const byBasis: Record<string, number> = {};
  for (const r of rows) if (r.new.status === 'matched') byBasis[r.new.basis!] = (byBasis[r.new.basis!] || 0) + 1;

  const md: string[] = [];
  md.push(`# Pricing audit — ${new Date().toISOString().slice(0, 10)}`, '');
  md.push(`Catalog products: ${total}. Price lines: ${items.length} (PDF re-check: ${items.length - pdfMismatch.length}/${items.length} identical${pdfMismatch.length ? '; MISMATCH: ' + pdfMismatch.join('; ') : ''}; duplicate lines: ${dupKeys.length ? dupKeys.join(', ') : 'none'}).`, '');
  md.push(`| | count |`, `|---|---|`, `| Verified (price used) | ${verified} |`, `| Manually confirmed | 0 (made on the phone) |`, `| Suggested, awaiting your review | ${suggested} |`, `| Unmatched | ${unmatched} |`, `| Coverage | ${((verified / total) * 100).toFixed(1)}% |`, '');
  md.push(`Verified by basis: ${JSON.stringify(byBasis)}`, '');
  md.push(`Before: ${count((r) => r.old.status === 'matched')} automatic + ${count((r) => r.old.status === 'rule90')} by the 90% rule = ${count((r) => r.old.price != null)} priced.`, '');
  md.push(`## Prices that change to a different line (${changedLine.length})`, ...changedLine.map((r) => `- ${r.catalog}: ${r.old.line} ${$(r.old.price!)} → ${r.new.line} ${$(r.new.price!)}`), '');
  md.push(`## Were priced, now need your confirmation or have no match (${demoted.length})`, ...demoted.map((r) => `- [${r.old.status}] ${r.catalog}: was ${r.old.line} ${$(r.old.price!)} → ${r.new.status} (${r.new.confidence}) ${r.new.flags.join('; ')}`), '');
  md.push(`## Newly verified (${promoted.length})`, ...promoted.map((r) => `- ${r.catalog} → ${r.new.line} ${$(r.new.price!)} (${r.new.basis}; ${r.new.notes.join('; ')})`), '');
  md.push(`## Review table (${suggested})`, '', '| Catalog Product | Suggested Match | Price | Confidence | Reason |', '|---|---|---|---|---|');
  for (const r of rows.filter((x) => x.new.status === 'review').sort((a, b) => b.new.confidence - a.new.confidence)) md.push(`| ${r.catalog} | ${r.new.line} | ${$(r.new.price!)} | ${r.new.confidence}% | ${r.new.flags.join('; ')} |`);
  md.push('', `## Unmatched (${unmatched})`, '', '| Catalog Product | Closest line (info only) | Confidence | Reason |', '|---|---|---|---|');
  for (const r of rows.filter((x) => x.new.status === 'unmatched')) md.push(`| ${r.catalog} | ${r.new.line || 'No Match Found'} | ${r.new.line ? r.new.confidence + '%' : ''} | ${r.new.flags.join('; ')} |`);
  md.push('', '## All verified (for spot checks)', ...rows.filter((r) => r.new.status === 'matched').map((r) => `- ${r.catalog} → ${r.new.line} ${$(r.new.price!)} [${r.new.confidence} ${r.new.basis}] ${r.new.notes.join('; ')}`));
  fs.writeFileSync(process.env.OUT + '.md', md.join('\n'));
  fs.writeFileSync(process.env.OUT + '.json', JSON.stringify({ total, verified, suggested, unmatched, pdfMismatch, rows }, null, 1));
});

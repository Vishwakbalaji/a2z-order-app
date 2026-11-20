/**
 * Best-effort product catalog extraction from a text-based PDF.
 * Catalog layouts vary a lot, so this produces an EDITABLE preview:
 *  - lines with a size, case count or product code become products,
 *  - bigger / heading-like lines become Department (largest) and Category,
 *  - brand = the longest known brand at the start of the line, else the first word,
 *  - repeated page headers/footers are dropped.
 * Prices on catalog lines are ignored (prices come from the price sheet).
 */
import { normText, parsePack, parseSize } from '../normalize';
import { groupLines, joinItems, type PageText } from './textItems';
import type { CatalogRowInput } from '../../db/importer';

const SKU_RE = /(?:^|\s)(#?\d{5,14}|[A-Z]{1,4}-?\d{3,10})(?=\s|$)/;
const PRICE_RE = /\$?\s?\d{1,4}\.\d{2}\s*$/;

interface Line {
  page: number;
  text: string;
  h: number;
}

export function parseCatalog(pages: PageText[], knownBrands: string[]): { rows: CatalogRowInput[]; warnings: string[] } {
  const warnings: string[] = [];
  const lines: Line[] = [];
  for (const pg of pages) {
    for (const l of groupLines(pg.items)) {
      const text = joinItems(l).trim();
      if (text) lines.push({ page: pg.page, text, h: Math.max(...l.map((i) => i.h)) });
    }
  }
  // repeated headers / footers
  const pageCount = pages.length;
  const freq = new Map<string, Set<number>>();
  for (const l of lines) {
    const k = normText(l.text).replace(/\d+/g, '#');
    if (!freq.has(k)) freq.set(k, new Set());
    freq.get(k)!.add(l.page);
  }
  const repeated = (l: Line) => pageCount >= 3 && (freq.get(normText(l.text).replace(/\d+/g, '#'))?.size || 0) >= Math.ceil(pageCount * 0.6);

  const isProduct = (t: string) => !!(parseSize(t) || parsePack(t) || SKU_RE.test(normText(t)));
  const bodyHs = lines.filter((l) => isProduct(l.text)).map((l) => l.h).sort((a, b) => a - b);
  const bodyH = bodyHs[Math.floor(bodyHs.length / 2)] || 10;
  const brands = [...new Set(knownBrands.map((b) => normText(b)).filter((b) => b.length >= 2))].sort((a, b) => b.length - a.length);

  let dept = '';
  let cat = '';
  const rows: CatalogRowInput[] = [];
  for (const l of lines) {
    if (repeated(l)) continue;
    const t = l.text.replace(/\s+/g, ' ').trim();
    if (/^page\s*\d+/i.test(t) || /^\d+$/.test(t)) continue;
    if (!isProduct(t)) {
      const letters = t.replace(/[^A-Za-z]/g, '');
      if (letters.length >= 3 && t.length <= 60 && t.split(' ').length <= 8) {
        if (l.h >= bodyH * 1.3) {
          dept = t;
          cat = '';
        } else if (l.h >= bodyH * 1.08 || t === t.toUpperCase()) {
          cat = t;
        }
      }
      continue;
    }
    let rest = t.replace(PRICE_RE, '').trim();
    let sku = '';
    const m = normText(rest).match(SKU_RE);
    if (m) {
      sku = m[1].replace(/^#/, '');
      rest = rest.replace(new RegExp(`(^|\\s)#?${sku.replace(/[-]/g, '\\-')}(?=\\s|$)`, 'i'), ' ').trim();
    }
    const n = normText(rest);
    const brand = brands.find((b) => n === b || n.startsWith(b + ' ')) || '';
    const size = parseSize(rest);
    const pack = parsePack(rest);
    const variation = [size?.label, pack?.label].filter(Boolean).join(' / ');
    rows.push({
      department: dept,
      category: cat,
      brand: brand ? rest.slice(0, brand.length) : rest.split(' ')[0],
      name: (brand ? rest.slice(brand.length) : rest.split(' ').slice(1).join(' ')).trim(),
      variation: '',
      unitsPerCase: pack?.units ?? null,
      sku,
      raw: t,
    });
    if (!variation) warnings.push(`No size/case count found in: "${t}"`);
  }
  if (!rows.length) warnings.unshift('No product lines were recognised. Try the CSV import instead.');
  return { rows, warnings: warnings.slice(0, 30) };
}

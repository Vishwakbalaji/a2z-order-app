import { describe, it, expect } from 'vitest';
import { loadPdfPages } from './pdfNode';
import { parsePriceSheet } from '../src/lib/pdf/priceSheetParser';
import { A2Z_PRICE_ROWS } from '../src/data/a2zPriceSheet';
import { parseMoneyToCents } from '../src/lib/money';

const PDF = new URL('./fixtures/A2Z_Beverages_Price_Deals_A4_2.pdf', import.meta.url).pathname;

describe('A2Z price sheet PDF parser', () => {
  it('extracts exactly the 131 hand-verified rows (brand, size, section, price)', async () => {
    const pages = await loadPdfPages(PDF);
    const { rows, warnings } = parsePriceSheet(pages); // no known-brand hints: pure layout
    const got = rows.map((r) => [r.section, r.brand, r.desc, (r.priceCents / 100).toFixed(2)].join(' | '));
    const want = A2Z_PRICE_ROWS.map(([s, b, d, p]) => [s, b, d, (parseMoneyToCents(p)! / 100).toFixed(2)].join(' | '));
    const missing = want.filter((w) => !got.includes(w));
    const extra = got.filter((g) => !want.includes(g));
    expect({ missing, extra, warnings }).toEqual({ missing: [], extra: [], warnings: [] });
    expect(rows.length).toBe(131);
  });
});

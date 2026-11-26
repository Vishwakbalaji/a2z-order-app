/**
 * The owner's price notes written on the catalog PDF "A2Z_Beverages_Product_List_11.20.26_.pdf" (uploaded
 * 2026-11-26, red FreeText notes on pages 1–2; pages 3–6 have none; no catalog row was changed).
 * Each note gives the case price for a brand group by size / case count, e.g. "PRICE OF COKE, SPRITE, AND
 * FANTA: 20 OZ 24CT - $32.99". Two single notes sit next to one product each (Canada Dry Zero Sugar).
 *
 * `text` is the note exactly as written. `entries` are the same lines with the size and count read out.
 * A note line applies to a catalog product of those groups only when size AND case count (and a multipack
 * such as 2 × 12) are identical. "PK", "CT" and "P" are the same thing (case count). Nothing is calculated.
 */
import { A2Z_CATALOG_ROWS } from './a2zCatalog';
import { standardName } from '../lib/naming';
import type { SupplementRow } from './supplementPrices';

export const CATALOG_NOTES_FILE = 'A2Z_Beverages_Product_List_11.20.26_.pdf (your price notes)';

export interface NoteEntry {
  label: string; // as written
  size: string | null; // "20 OZ", "2 L", "355 ML"; null = no size written ("2/12")
  count: number | null; // case count; null = not written ("20 OZ - $23.99")
  multi?: string; // "2×12", "2×4" for multipacks
  cents: number;
}
export interface PriceNote {
  groups: string[]; // catalog Group column
  text: string;
  entries: NoteEntry[];
}

const c = (d: number) => Math.round(d * 100);
const e = (label: string, size: string | null, count: number | null, dollars: number, multi?: string): NoteEntry => ({ label, size, count, cents: c(dollars), ...(multi ? { multi } : {}) });

export const PRICE_NOTES: PriceNote[] = [
  {
    groups: ['Coke', 'Sprite', 'Fanta'],
    text: 'PRICE OF COKE, SPRITE, AND FANTA: 12OZ 2/12CT - $16.99 | 20 OZ 24CT - $32.99 | 20 OZ 24 PK - $32.99 | 16 OZ 24 CT -$30.99 | 16 OZ 24 PK - $30.99 | 2L 8CT - $21.50 | 2L 1/8PK - $21.50 | 355 ML 24 CT - $40.99',
    entries: [e('12OZ 2/12CT', '12 OZ', 24, 16.99, '2×12'), e('20 OZ 24CT / 24 PK', '20 OZ', 24, 32.99), e('16 OZ 24 CT / 24 PK', '16 OZ', 24, 30.99), e('2L 8CT / 1/8PK', '2 L', 8, 21.5), e('355 ML 24 CT', '355 ML', 24, 40.99)],
  },
  {
    groups: ['Canada Dry'],
    text: '12OZ 24CT - $12.99 | 20 OZ 24CT - $25.99 | 2L 8CT - $13.99 | 1L 15 CT - $24.99',
    entries: [e('12OZ 24CT', '12 OZ', 24, 12.99), e('20 OZ 24CT', '20 OZ', 24, 25.99), e('2L 8CT', '2 L', 8, 13.99), e('1L 15 CT', '1 L', 15, 24.99)],
  },
  {
    groups: ['Pepsi', 'Mountain Dew', 'Dr Pepper'],
    text: 'PRICE OF PEPSI, MOUNTAIN DEW, AND Dr PEPPER: 12OZ 2/12CT - $14.99 | 2/12 12OZ - $14.99 | 12OZ 36CT - $14.99 | 20 OZ 24CT - $25.99 | 20 OZ 24PK - $25.99 | 20 OZ 24 - $25.99 | 2L 8CT - $13.99 | 2L 2-4PK - $13.99',
    entries: [e('12OZ 2/12CT / 2/12 12OZ', '12 OZ', 24, 14.99, '2×12'), e('12OZ 36CT', '12 OZ', 36, 14.99), e('20 OZ 24CT / 24PK / 24', '20 OZ', 24, 25.99), e('2L 8CT', '2 L', 8, 13.99), e('2L 2-4PK', '2 L', 8, 13.99, '2×4')],
  },
  {
    groups: ['Sunkist', 'Crush', 'Schweeps'],
    text: 'PRICE OF SUNKIST, CRUSH, AND SCHWEEPS: 12OZ 2/12CT - $12.99 | 2/12 12OZ - $12.99 | 12OZ 2/12 PACK - $12.99 | 2/12 - $12.99 | 12OZ 36CT - $12.99 | 20 OZ 24CT - $25.99 | 20 OZ 24PK - $25.99 | 2L 8CT - $13.99',
    entries: [e('12OZ 2/12CT / 2/12 12OZ / 12OZ 2/12 PACK', '12 OZ', 24, 12.99, '2×12'), e('2/12', null, 24, 12.99, '2×12'), e('12OZ 36CT', '12 OZ', 36, 12.99), e('20 OZ 24CT / 24PK', '20 OZ', 24, 25.99), e('2L 8CT', '2 L', 8, 13.99)],
  },
  {
    groups: ['Gatorade'],
    text: 'PRICE OF GATORADE: 20 OZ 24PK - $23.99 | 20 OZ 24 CT - $23.99 | 20 OZ - $23.99 | 28 OZ 15PK - $29.99 | 28 OZ 15P - $29.99 | 16 OZ - $23.99 | 12 OZ 24CT - $23.99',
    entries: [e('20 OZ 24PK / 24 CT', '20 OZ', 24, 23.99), e('20 OZ', '20 OZ', null, 23.99), e('28 OZ 15PK / 15P', '28 OZ', 15, 29.99), e('16 OZ', '16 OZ', null, 23.99), e('12 OZ 24CT', '12 OZ', 24, 23.99)],
  },
  {
    groups: ['AW', '7UP'],
    text: 'PRICE OF AW AND 7UP: 12OZ 36CT - $12.99 | 12OZ 2/12 - $12.99 | 12OZ 2-12PK - $12.99 | 20OZ 24CT - $25.99 | 2L 8CT - $13.99 | 2L 8PK - $13.99',
    entries: [e('12OZ 36CT', '12 OZ', 36, 12.99), e('12OZ 2/12 / 2-12PK', '12 OZ', 24, 12.99, '2×12'), e('20OZ 24CT', '20 OZ', 24, 25.99), e('2L 8CT / 8PK', '2 L', 8, 13.99)],
  },
];

/** Single notes written next to one catalog line (his choice between the two possible prices). */
export const PRODUCT_NOTES: { line: string; text: string; cents: number }[] = [
  { line: 'CANADA DRY GINGER ALE ZERO SUGAR 2', text: '- $25.99 (next to this line; = 20 oz / 24 ct)', cents: c(25.99) },
  { line: 'CANADA DRY TONIC WATER ZERO SUGAR 1', text: '- $24.99 (next to this line; = 1 L / 15 ct)', cents: c(24.99) },
];

/** Size / count / multipack of a catalog line, read from its standardized size label. */
export function lineKey(line: string, group: string): { size: string | null; count: number | null; multi?: string } {
  const s = standardName(line, group).size;
  const bare = /^(\d+)\/(\d+)$/.exec(s); // "SCHWEEPS Can 2/12" → 2 × 12, no size printed
  if (bare) return { size: null, count: +bare[1] * +bare[2], multi: `${bare[1]}×${bare[2]}` };
  const size = /^([\d.]+ (?:OZ|ML|L))\b/.exec(s)?.[1] ?? null;
  const count = /(\d+) CT\b/.exec(s)?.[1];
  const m = /\((\d+) × (\d+)\)/.exec(s);
  return { size, count: count ? +count : null, ...(m && m[1] !== '1' ? { multi: `${m[1]}×${m[2]}` } : {}) };
}

/** The note line for a catalog product, or null when no note line has the same size and count. */
export function noteFor(line: string, group: string): { note: PriceNote; entry: NoteEntry } | null {
  const k = lineKey(line, group);
  for (const note of PRICE_NOTES) {
    if (!note.groups.includes(group)) continue;
    const entry = note.entries.find((x) => x.size === k.size && x.count === k.count && (x.multi ?? null) === (k.multi ?? null));
    if (entry) return { note, entry };
  }
  return null;
}

/** Rows for the bundled update: confirmed (green) — the owner wrote these prices himself. */
export function catalogNoteRows(): SupplementRow[] {
  const rows: SupplementRow[] = [];
  const single = new Map(PRODUCT_NOTES.map((n) => [n.line, n]));
  for (const [, group, line] of A2Z_CATALOG_ROWS) {
    const one = single.get(line);
    if (one) {
      rows.push({ row: `Your note: ${one.text}`, color: 'red', cents: one.cents, products: [line] });
      continue;
    }
    const hit = noteFor(line, group);
    if (hit) rows.push({ row: `Your note: ${hit.entry.label} - $${(hit.entry.cents / 100).toFixed(2)}`, color: 'red', cents: hit.entry.cents, sheet: hit.note.text.split(':')[0], products: [line] });
  }
  return rows;
}

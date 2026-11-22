import type { DraftLine, PriceItem, PriceOption, PriceStatus, Product, Totals } from '../types';
import { editDistance, normText, parsePack, tokens } from './normalize';
import { standardName } from './naming';

type Naming = Pick<Product, 'brand' | 'name' | 'variation'> & { origin?: Product['origin']; catalogName?: string; category?: string };

/**
 * Does the product name already say the brand? ("COKE CAN" for brand Coke, "NESQUICK …" for
 * Nesquik, "ESSENTIAL WATER" for Essentia). Then the brand is not repeated in front of it.
 */
function nameHasBrand(name: string, brand: string): boolean {
  const first = tokens(brand)[0];
  if (!first) return true;
  const compact = (s: string) => normText(s).replace(/[^A-Z0-9]/g, '');
  if (compact(name).includes(compact(first))) return true;
  return first.length >= 5 && tokens(name).some((t) => t.length >= 5 && editDistance(t, first, 1) <= 1);
}

/**
 * Full product name. Catalog products keep the distributor's catalog description exactly
 * (name + size part), adding the brand in front only when the name doesn't already contain it
 * (e.g. CSV catalogs with a separate brand column). Other products: brand + name + size.
 */
/** The A2Z catalog prints every line in capitals; products you import yourself keep your own wording. */
const isA2ZLine = (p: { origin?: Product['origin']; catalogName?: string }) => p.origin === 'catalog' && !!p.catalogName && p.catalogName === p.catalogName.toUpperCase();

export function displayName(p: Naming): string {
  // catalog products: standardized name from the original catalog line ("PEPSI DIET — 12 OZ / 24 CT (2 × 12)")
  if (isA2ZLine(p)) return standardName(p.catalogName!, p.category).full;
  const parts = p.origin === 'catalog' && nameHasBrand(p.name, p.brand) ? [p.name, p.variation] : [p.brand, p.name, p.variation];
  return parts.map((s) => (s || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

/** Name without the size part (for the product card title). */
export function titleName(p: Pick<Product, 'brand' | 'name'> & { origin?: Product['origin']; catalogName?: string; category?: string }): string {
  if (isA2ZLine(p)) return standardName(p.catalogName!, p.category).title;
  const parts = p.origin === 'catalog' && nameHasBrand(p.name, p.brand) ? [p.name] : [p.brand, p.name];
  return parts.map((s) => (s || '').trim()).filter(Boolean).join(' ');
}

/** Size / case count line ("12 OZ / 24 CT (2 × 12)"); other products: their size text as entered. */
export function sizeLabel(p: Pick<Product, 'variation'> & { origin?: Product['origin']; catalogName?: string; category?: string }): string {
  if (isA2ZLine(p)) return standardName(p.catalogName!, p.category).size;
  return (p.variation || '').trim();
}

export function priceItemKey(brand: string, desc: string): string {
  return `${normText(brand)}|${normText(desc)}`;
}

export function mappingKey(p: Pick<Product, 'sku' | 'catalogName' | 'brand' | 'name' | 'variation'>): string {
  if (p.sku && p.sku.trim()) return `SKU:${p.sku.trim().toUpperCase()}`;
  return `N:${normText(p.catalogName || displayName(p))}`;
}

export interface PriceInfo {
  cents: number | null; // the case price used in totals (confirmed or approximate), else null
  status: PriceStatus;
  source: string; // where the price comes from, in words
  options?: PriceOption[]; // 'review': the possible prices to choose from
  suggestion?: number | null; // 'review': a suggested price (not used in totals)
}

/**
 * The case price and its status. Order: your own entry/confirmation → the supplemental price list →
 * a confirmed price-sheet match → a suggestion waiting for review → not listed. Never guessed.
 */
export function priceInfo(p: Product, priceItems: Map<string, PriceItem>): PriceInfo {
  if (p.priceOverrideCents != null) return { cents: p.priceOverrideCents, status: 'confirmed', source: p.priceConfirmedAt ? 'Confirmed by you' : 'Entered by you' };
  const s = p.supplement;
  if (s) {
    if ((s.status === 'confirmed' || s.status === 'approximate') && s.cents != null)
      return { cents: s.cents, status: s.status, source: `Your price list (${s.status === 'confirmed' ? 'red' : 'orange'})${s.sheetRef ? ` · ${s.sheetRef}` : ''}` };
    if (s.status === 'select') return { cents: null, status: 'review', source: 'Your price list: choose the right price', options: s.options || [] };
    if (s.status === 'none') return { cents: null, status: 'none', source: 'Not on the price sheet' };
  }
  if (p.matchStatus === 'matched' && p.priceItemId) {
    const it = priceItems.get(p.priceItemId);
    if (it) return { cents: it.priceCents, status: 'confirmed', source: `Price sheet: ${it.brand} ${it.desc}` };
  }
  if (p.matchStatus === 'review') {
    const it = p.suggestedPriceItemId ? priceItems.get(p.suggestedPriceItemId) : undefined;
    return { cents: null, status: 'review', source: it ? `Suggested: ${it.brand} ${it.desc}` : 'Needs review', suggestion: it?.priceCents ?? null };
  }
  return { cents: null, status: 'none', source: 'Not listed' };
}

/** Case price used in totals (confirmed or approximate), or null if not known. */
export function effectivePrice(p: Product, priceItems: Map<string, PriceItem>): number | null {
  return priceInfo(p, priceItems).cents;
}

export function unitsFromText(text: string): number | null {
  return parsePack(text)?.units ?? null;
}

/** Totals in integer cents. Lines without a price are counted separately, never guessed. */
export function computeTotals(lines: DraftLine[], priceOf: (productId: string) => number | null, isApprox?: (productId: string) => boolean): Totals {
  const t: Totals = { products: 0, cases: 0, valueCents: 0, unpricedLines: 0, unpricedCases: 0, approxLines: 0 };
  for (const l of lines) {
    if (!(l.qty > 0)) continue;
    t.products += 1;
    t.cases += l.qty;
    const price = priceOf(l.productId);
    if (price == null) {
      t.unpricedLines += 1;
      t.unpricedCases += l.qty;
    } else {
      t.valueCents += price * l.qty;
      if (isApprox?.(l.productId)) t.approxLines! += 1;
    }
  }
  return t;
}

/**
 * Price-sheet products are hidden from browsing once a catalog/manual product is
 * matched to the same price line (the catalog product is the more specific one).
 */
export function supersededPriceItemIds(products: Product[]): Set<string> {
  const s = new Set<string>();
  for (const p of products) if (p.origin !== 'pricesheet' && p.active && p.matchStatus === 'matched' && p.priceItemId) s.add(p.priceItemId);
  return s;
}

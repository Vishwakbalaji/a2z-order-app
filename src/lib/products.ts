import type { DraftLine, PriceItem, Product, Totals } from '../types';
import { normText, parsePack } from './normalize';

export function displayName(p: Pick<Product, 'brand' | 'name' | 'variation'>): string {
  return [p.brand, p.name, p.variation].map((s) => (s || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

/** Name without the variation (for the product card title). */
export function titleName(p: Pick<Product, 'brand' | 'name'>): string {
  return [p.brand, p.name].map((s) => (s || '').trim()).filter(Boolean).join(' ');
}

export function priceItemKey(brand: string, desc: string): string {
  return `${normText(brand)}|${normText(desc)}`;
}

export function mappingKey(p: Pick<Product, 'sku' | 'catalogName' | 'brand' | 'name' | 'variation'>): string {
  if (p.sku && p.sku.trim()) return `SKU:${p.sku.trim().toUpperCase()}`;
  return `N:${normText(p.catalogName || displayName(p))}`;
}

/**
 * Case price for a product, or null if not reliably known.
 * A 'review' or 'unmatched' product never gets a price unless one was entered manually.
 */
export function effectivePrice(p: Product, priceItems: Map<string, PriceItem>): number | null {
  if (p.priceOverrideCents != null) return p.priceOverrideCents;
  if (p.matchStatus === 'matched' && p.priceItemId) return priceItems.get(p.priceItemId)?.priceCents ?? null;
  return null;
}

export function unitsFromText(text: string): number | null {
  return parsePack(text)?.units ?? null;
}

/** Totals in integer cents. Lines without a price are counted separately, never guessed. */
export function computeTotals(lines: DraftLine[], priceOf: (productId: string) => number | null): Totals {
  const t: Totals = { products: 0, cases: 0, valueCents: 0, unpricedLines: 0, unpricedCases: 0 };
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

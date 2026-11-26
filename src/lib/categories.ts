import type { PriceItem, Product } from '../types';

/**
 * Categories as printed on the price sheet: section (WATER, SODA, …) → brand heading
 * ("COKE / FANTA / SPRITE & FLAVORS", "PEPSI / DEW / DR PEPPER", …).
 * A catalog brand group goes under the price-sheet heading most of its products are priced from, so a brand
 * stays together (all Canada Dry in one place). Brands that are not on the price sheet keep their own name.
 */
export interface CategoryInfo {
  sub: Map<string, string>; // productId → brand heading
  subsByDept: Map<string, string[]>; // department → headings in price-sheet order
}

const KEEP = new Set(['OKF', 'C4', '7UP', 'II', 'IVB', 'NOS']);
const FIX: Record<string, string> = { Schweeps: 'Schweppes', Bodyarmor: 'BodyArmor', 'Body Armor': 'BodyArmor', AW: 'A&W', BAI: 'Bai', BEVERAGE: 'Beverage' };
export function niceLabel(s: string): string {
  if (FIX[s]) return FIX[s];
  if (s !== s.toUpperCase()) return s; // already written by hand ("Topo Chico")
  const t = s
    .split(/(\s+|\/|-)/)
    .map((w) => (KEEP.has(w) || /[\d&]/.test(w) || w.length <= 1 ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join('');
  return FIX[t] ?? t;
}

export function buildCategories(visible: Product[], priceItemById: Map<string, PriceItem>): CategoryInfo {
  const sheetOrder = new Map<string, number>();
  [...priceItemById.values()].sort((a, b) => a.order - b.order).forEach((i) => sheetOrder.has(i.brand) || sheetOrder.set(i.brand, sheetOrder.size));
  // catalog group → votes for price-sheet headings
  const votes = new Map<string, Map<string, number>>();
  for (const p of visible) {
    if (p.origin !== 'catalog') continue;
    const it = priceItemById.get(p.priceItemId || '') || priceItemById.get(p.suggestedPriceItemId || '');
    if (!it) continue;
    const g = p.category || p.brand;
    const m = votes.get(g) || new Map<string, number>();
    m.set(it.brand, (m.get(it.brand) || 0) + 1);
    votes.set(g, m);
  }
  const groupHeading = new Map<string, string>();
  for (const [g, m] of votes) groupHeading.set(g, [...m.entries()].sort((a, b) => b[1] - a[1] || (sheetOrder.get(a[0])! - sheetOrder.get(b[0])!))[0][0]);

  const sub = new Map<string, string>();
  const rank = new Map<string, number>(); // heading → sort rank (price-sheet order first, other brands after)
  let extra = 10_000;
  for (const p of visible) {
    const raw = p.origin === 'catalog' ? groupHeading.get(p.category || p.brand) || p.category || p.brand : p.brand;
    const label = niceLabel(raw || 'Other');
    sub.set(p.id, label);
    if (!rank.has(label)) rank.set(label, sheetOrder.has(raw) ? sheetOrder.get(raw)! : extra++);
  }
  const subsByDept = new Map<string, string[]>();
  for (const p of visible) {
    const d = p.department || 'Other';
    const list = subsByDept.get(d) || [];
    const l = sub.get(p.id)!;
    if (!list.includes(l)) list.push(l);
    subsByDept.set(d, list);
  }
  for (const list of subsByDept.values()) list.sort((a, b) => rank.get(a)! - rank.get(b)!);
  return { sub, subsByDept };
}

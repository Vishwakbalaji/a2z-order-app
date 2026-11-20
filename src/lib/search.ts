/**
 * Fast in-memory product search: every query word must match a word of the product
 * (exact > prefix > substring > small typo), so "500 water", "zeph 20", "pellegrno"
 * and "smartwater" all work. Index building is O(n); a query over 1,000+ products
 * takes well under a few milliseconds.
 */
import type { Product } from '../types';
import { editDistance, normText, parseSize, tokens } from './normalize';
import { canon } from './matching';

export interface IndexEntry {
  id: string;
  words: string[];
  compact: string;
  brandWords: Set<string>;
  alt: string[]; // equivalent sizes (e.g. 16.9OZ -> 500ML), ranked below printed words
}

export function buildIndex(products: Product[]): Map<string, IndexEntry> {
  const idx = new Map<string, IndexEntry>();
  for (const p of products) {
    const text = canon([p.brand, p.name, p.variation, p.department, p.category, p.sku, p.catalogName].join(' '));
    const words = new Set(tokens(text));
    // also index sizes in mL so "500" finds 16.9OZ / 0.5L bottles
    const sz = parseSize(text);
    const alt: string[] = [];
    if (sz?.ml) {
      alt.push(`${Math.round(sz.ml)}ML`);
      if (sz.ml >= 1000) alt.push(`${+(sz.ml / 1000).toFixed(2)}L`);
    }
    idx.set(p.id, {
      id: p.id,
      words: [...words],
      compact: text.replace(/[^A-Z0-9]/g, ''),
      brandWords: new Set(tokens(canon(p.brand))),
      alt: alt.filter((a) => !words.has(a)),
    });
  }
  return idx;
}

function tokenScore(q: string, e: IndexEntry): number {
  let best = 0;
  for (const w of e.words) {
    if (w === q) return e.brandWords.has(w) ? 3.5 : 3;
    if (w.startsWith(q)) best = Math.max(best, e.brandWords.has(w) ? 2.5 : 2);
    else if (q.length >= 3 && w.includes(q)) best = Math.max(best, 1);
  }
  if (best) return best;
  for (const w of e.alt) if (w.startsWith(q)) return 1.2;
  if (q.length >= 4 && e.compact.includes(q.replace(/[^A-Z0-9]/g, ''))) return 1;
  if (q.length >= 4 && !/^\d/.test(q)) {
    const max = q.length >= 7 ? 2 : 1;
    for (const w of e.words) {
      if (Math.abs(w.length - q.length) <= max && editDistance(w, q, max) <= max) return 0.8;
      // typo in the first letters of a longer word ("pelegr" ~ "PELLEGRINO")
      if (w.length > q.length && editDistance(w.slice(0, q.length), q, 1) <= 1) best = Math.max(best, 0.6);
    }
  }
  return best;
}

/** Returns matching product ids, best first; ties keep catalog order. */
export function search(query: string, ids: string[], idx: Map<string, IndexEntry>): string[] {
  const qt = tokens(canon(query));
  if (!qt.length) return ids;
  const scored: { id: string; s: number; i: number }[] = [];
  ids.forEach((id, i) => {
    const e = idx.get(id);
    if (!e) return;
    let total = 0;
    for (const q of qt) {
      const s = tokenScore(q, e);
      if (!s) return;
      total += s;
    }
    scored.push({ id, s: total, i });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.map((x) => x.id);
}

export { normText };

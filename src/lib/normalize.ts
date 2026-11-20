/**
 * Text / size / pack normalization shared by search, matching and parsing.
 * Pure functions — no app state — so they are easy to unit test.
 */

const ML_PER: Record<string, number> = {
  OZ: 29.5735,
  ML: 1,
  L: 1000,
  GAL: 3785.41,
};

/** Uppercase, unify units and pack words, collapse whitespace. */
export function normText(input: string): string {
  let s = ` ${(input || '').toUpperCase()} `;
  s = s.replace(/[’']/g, '');
  s = s.replace(/\s+/g, ' ');
  // join "500 ML" -> "500ML", "1.5 L" -> "1.5L"
  s = s.replace(/(\d)\s*(FL\.?\s*OZ|FLOZ|OUNCES?|OZS?)\b/g, '$1OZ');
  s = s.replace(/(\d)\s*(MILLILITERS?|MILLILITRES?|MLS?)\b/g, '$1ML');
  s = s.replace(/(\d)\s*(LITERS?|LITRES?|LTRS?|LTS?|LT|L)\b/g, '$1L');
  s = s.replace(/(\d)\s*(GALLONS?|GALS?)\b/g, '$1GAL');
  s = s.replace(/(\d)\s*(GRAMS?|GMS?|GRS?|G)\b/g, '$1G');
  // pack: 24PK, 24 PACK, 24 COUNT, 24CT, 24 CS -> 24CT
  s = s.replace(/(\d)\s*(PACKS?|PKS?|PK|COUNT|CNT|CTS?)\b/g, '$1CT');
  s = s.replace(/\b(\d+)\s*X\s*(\d+(?:\.\d+)?)(OZ|ML|L|GAL|G)\b/g, '$1CT $2$3');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Tokens for matching/search (keeps "2-12CT", "A&W"). */
export function tokens(input: string): string[] {
  return normText(input)
    .replace(/[(),:;]/g, ' ')
    .split(/[\s/]+/)
    .map((t) => t.replace(/^[.\-&]+|[.\-&]+$/g, ''))
    .filter(Boolean);
}

export interface SizeInfo {
  ml?: number; // liquid volume in mL
  grams?: number; // weight
  label: string; // e.g. "16.9OZ"
}

/** First size found in the text ("16.9OZ", "500ML", "1.5L", "1GAL", "42G"). */
export function parseSize(input: string): SizeInfo | null {
  const s = normText(input);
  const m = s.match(/(?:^|[^\w.])(\d+(?:\.\d+)?)(OZ|ML|L|GAL|G)\b/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const unit = m[2];
  if (unit === 'G') return { grams: v, label: `${m[1]}G` };
  return { ml: v * ML_PER[unit], label: `${m[1]}${unit}` };
}

export function sameSize(a: SizeInfo | null, b: SizeInfo | null): boolean | null {
  if (!a || !b) return null;
  if (a.grams != null || b.grams != null) return a.grams != null && b.grams != null && Math.abs(a.grams - b.grams) < 0.01;
  const x = a.ml!, y = b.ml!;
  return Math.abs(x - y) / Math.max(x, y) <= 0.03; // 16.9OZ ≈ 500ML ≈ 0.5L
}

export interface PackInfo {
  units: number; // total units per case
  label: string; // e.g. "2-12CT"
}

/** Units per case: "24CT", "2-12CT" (=24), "1200 BAGS", "CASE 24", "/ 24". */
export function parsePack(input: string): PackInfo | null {
  const s = normText(input);
  let m = s.match(/\b(\d+)\s*[-X]\s*(\d+)CT\b/);
  if (m) return { units: parseInt(m[1]) * parseInt(m[2]), label: `${m[1]}-${m[2]}CT` };
  m = s.match(/\b(\d+)CT\b/);
  if (m) return { units: parseInt(m[1]), label: `${m[1]}CT` };
  m = s.match(/\b(\d+)\s*(BAGS|BOTTLES|CANS|PCS|PIECES|UNITS)\b/);
  if (m) return { units: parseInt(m[1]), label: `${m[1]} ${m[2]}` };
  m = s.match(/\bCASE\s*(?:OF\s*)?(\d+)\b/);
  if (m) return { units: parseInt(m[1]), label: `CASE ${m[1]}` };
  return null;
}

export type Packaging = 'GLASS' | 'CAN' | 'PLASTIC' | null;
export function parsePackaging(input: string): Packaging {
  const s = normText(input);
  if (/\bGLASS\b/.test(s)) return 'GLASS';
  if (/\bCANS?\b/.test(s)) return 'CAN';
  if (/\b(PLASTIC|PET)\b/.test(s)) return 'PLASTIC';
  return null;
}

/** Words that describe a variant (still/sparkling, sport cap...) — must agree when both present. */
const VARIANT_WORDS = ['STILL', 'SPARKLING', 'SPORT', 'DIET', 'ZERO'];
export function variantWords(input: string): string[] {
  const t = new Set(tokens(input).map((w) => (w === 'SPORTS' ? 'SPORT' : w)));
  return VARIANT_WORDS.filter((w) => t.has(w));
}

/** Sørensen–Dice coefficient on character bigrams (0..1). */
export function dice(a: string, b: string): number {
  a = a.replace(/\s+/g, '');
  b = b.replace(/\s+/g, '');
  if (a === b) return a.length ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const map = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    map.set(g, (map.get(g) || 0) + 1);
  }
  let inter = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const c = map.get(g) || 0;
    if (c > 0) {
      map.set(g, c - 1);
      inter++;
    }
  }
  return (2 * inter) / (a.length + b.length - 2);
}

/** Bounded Levenshtein distance (returns max+1 when exceeded). */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** "COKE / FANTA / SPRITE & FLAVORS" -> ["COKE","FANTA","SPRITE"] */
export function brandAlternatives(brand: string): string[] {
  return normText(brand)
    .split(/\s*\/\s*|\s+&\s+|\s+AND\s+|,/)
    .map((s) => s.replace(/\b(FLAVORS?|WATER|JUICE|TEA|DRINKS?)\b/g, '').trim())
    .filter(Boolean);
}

export function slug(s: string): string {
  return s.replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Store';
}

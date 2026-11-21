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
  // common typing slips in distributor lists (parsing only; original text is kept for display)
  s = s.replace(/(\d)0Z\b/g, '$1OZ'); // "120Z" -> "12OZ"
  s = s.replace(/(\d)OOZ\b/g, '$10OZ'); // "2OOZ" -> "20OZ"
  s = s.replace(/(^|[^\d.])\.(\d)/g, '$10.$2'); // ".5L" -> "0.5L"
  s = s.replace(/([A-Z])(\d+(?:\.\d+)?(?:OZ|ML|L|GAL|CT|PK)\b)/g, '$1 $2'); // "HAZE16OZ" -> "HAZE 16OZ"
  s = s.replace(/(\d)\s*FL\b(?!\.?\s*OZ)/g, '$1OZ'); // "13.7FL" -> "13.7OZ"
  s = s.replace(/\bALKLINE\b/g, 'ALKALINE');
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

/**
 * 'same' = identical within 0.5% (16.9OZ = 500ML = 0.5L), 'near' = 0.5–6% apart (8.4OZ vs 8OZ —
 * possibly the same product written differently: never priced automatically), 'diff' otherwise.
 */
export function sizeRelation(a: SizeInfo | null, b: SizeInfo | null): 'same' | 'near' | 'diff' | null {
  if (!a || !b) return null;
  if (a.grams != null || b.grams != null) return a.grams != null && b.grams != null && Math.abs(a.grams - b.grams) < 0.01 ? 'same' : 'diff';
  const r = Math.abs(a.ml! - b.ml!) / Math.max(a.ml!, b.ml!);
  return r <= 0.005 ? 'same' : r <= 0.06 ? 'near' : 'diff';
}
export function sameSize(a: SizeInfo | null, b: SizeInfo | null): boolean | null {
  const r = sizeRelation(a, b);
  return r === null ? null : r === 'same';
}

export interface PackInfo {
  units: number; // total units per case
  label: string; // e.g. "2-12CT"
}

/** Units per case: "24CT", "2-12CT" (=24), "1200 BAGS", "CASE 24", "/ 24". */
export function parsePack(input: string): PackInfo | null {
  const s = normText(input);
  // "1/4/6" = 4 six-packs
  let m = s.match(/\b(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)(?:CT)?\b/);
  if (m) {
    const f = [m[1], m[2], m[3]].map((x) => parseInt(x)).filter((x) => x > 1);
    return { units: f.reduce((a, b) => a * b, 1), label: f.length > 1 ? `${f.join('-')}CT` : `${f[0] || 1}CT` };
  }
  // "2-12CT", "2/12", "2/6PK", "4X6CT"; "1/12" is a plain case of 12
  m = s.match(/\b(\d+)\s*[-\/X]\s*(\d+)(?:CT)?\b(?!\s*(?:OZ|ML|L|GAL|G)\b)/);
  if (m && !/^0/.test(m[2])) {
    const a = parseInt(m[1]), b = parseInt(m[2]);
    return a === 1 ? { units: b, label: `${b}CT` } : { units: a * b, label: `${a}-${b}CT` };
  }
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
  if (/\b(GLASS|GLAS|GLS|GL)\b/.test(s)) return 'GLASS';
  if (/\bCANS?\b/.test(s)) return 'CAN';
  if (/\b(PLASTIC|PET)\b/.test(s)) return 'PLASTIC';
  return null;
}

/**
 * Words that make a different PRODUCT, not just a flavour: the price sheet lists these as
 * separate lines (still vs sparkling, sport cap) or they are clearly different items
 * (alkaline water, variety packs). Diet / zero / flavours share the brand + size price,
 * exactly as the price sheet is organised ("COKE / FANTA / SPRITE & FLAVORS", "MONSTER 16OZ").
 */
const VARIANT_WORDS = ['STILL', 'SPARKLING', 'SPORT', 'ALKALINE', 'VARIETY'];
export function variantWords(input: string): string[] {
  const t = new Set(tokens(input).map((w) => (w === 'SPORTS' ? 'SPORT' : w === 'VRTY' || w === 'VPK' ? 'VARIETY' : w)));
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

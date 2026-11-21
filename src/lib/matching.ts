/**
 * Catalog product ⇄ price sheet matching — the owner's verification policy (2026-11-21).
 *
 * For every catalog product and every price-sheet line this checks, in order:
 *   1. Brand — the price line must be for the product's own brand (catalog "Group"). Generic
 *      product-type lines ("GINGER ALE / 7UP / A&W", "CLUB SODA", "TONIC WATER") don't name a brand.
 *   2. Product type / variation — alkaline, variety pack, sport cap, still/sparkling, a different
 *      product line ("MINUTE MAID JUICE"), packaging. These are material differences.
 *   3. Size — exact (16.9OZ = 500ML), close (≤ 0.3 oz), near (≤ 6 %), otherwise a different product.
 *   4. Case count — must be the same number of units per case. A count cut off in the catalog
 *      ("…28OZ 12C") counts only when the visible digits (or same-size siblings) confirm it.
 *   5. Ambiguity — two price lines that both fit → the product is not verified.
 *
 * Every candidate gets a confidence (0–100) and a verdict:
 *   verified  (≥ 95, no material difference, unambiguous) → the price is used,
 *   suggested (75–94) → shown for the owner's confirmation, NOT used in totals,
 *   nomatch   (< 75)  → unmatched (the closest line may be shown for information).
 * Confidence is a matching heuristic, not a probability.
 */
import type { Mapping, MatchStatus, PriceItem, Product } from '../types';
import { brandAlternatives as brandAlternatives0, editDistance, normText as normText0, parsePack as parsePack0, parsePackaging as parsePackaging0, parseSize as parseSize0, tokens as tokens0, type SizeInfo } from './normalize';
import { displayName, mappingKey } from './products';

// Matching compares every catalog product with every price line, so the pure text helpers are memoized.
function memo<R>(f: (s: string) => R): (s: string) => R {
  const m = new Map<string, R>();
  return (x: string) => {
    let v = m.get(x);
    if (v === undefined && !m.has(x)) {
      if (m.size > 50_000) m.clear();
      v = f(x);
      m.set(x, v);
    }
    return v as R;
  };
}
const normText = memo(normText0);
const tokens = memo(tokens0);
const parseSize = memo(parseSize0);
const parsePack = memo(parsePack0);
const parsePackaging = memo(parsePackaging0);
const brandAlternatives = memo(brandAlternatives0);

const ALIASES: [RegExp, string][] = [
  [/\bCOCA[\s-]?COLA\b/g, 'COKE'],
  [/\bMOUNTAIN DEW\b|\bMTN\.? DEW\b/g, 'DEW'],
  [/\bSEVEN[\s-]?UP\b|\b7[\s-]UP\b/g, '7UP'],
  [/\bDR\.\s?PEPPER\b/g, 'DR PEPPER'],
  [/\bSMARTWATER\b/g, 'SMART WATER'],
  [/\bBODY ARMOU?R\b/g, 'BODYARMOR'],
  [/\bYOO ?HOO\b/g, 'YOO-HOO'],
  [/\bS\.? ?PELLEGRINO\b/g, 'SAN PELLEGRINO'],
];
export const canon = memo((s: string): string => {
  let t = normText(s);
  for (const [re, rep] of ALIASES) t = t.replace(re, rep);
  return t;
});

type ProductLike = Pick<Product, 'brand' | 'name' | 'variation' | 'sku' | 'unitsPerCase' | 'catalogName'> & { category?: string };

export type Verdict = 'verified' | 'suggested' | 'nomatch';
export type Basis = 'sku' | 'exact' | 'naming' | 'flavors-listed' | 'brand-level' | 'count-cut-off';

export interface Candidate {
  item: PriceItem;
  confidence: number; // 0–100
  verdict: Verdict;
  basis: Basis | null; // why it is verified (when verified)
  flags: string[]; // material differences / uncertainties → owner review
  notes: string[]; // non-blocking observations kept for traceability
  // kept for older screens
  score: number; // confidence / 100
  strong: boolean; // verdict === 'verified'
  evidence: boolean; // brand or wording actually agree
  reasons: string[]; // flags + notes
}

export interface MatchContext {
  /** The owner's answer: one generic brand line (no flavor named) prices every flavor/variety of that brand at that size and count. */
  brandLevelFlavors?: boolean;
  /** Same-group, same-size full case counts of other catalog products (for counts cut off in the catalog). */
  siblings?: Map<string, number[]>;
  /** All price lines (to see whether another packaging of the same size exists). */
  items?: PriceItem[];
}
export const DEFAULT_CONTEXT: MatchContext = { brandLevelFlavors: true };

const ML_PER_OZ = 29.5735;
const TYPE_ALTS = new Set(['GINGER ALE', 'CLUB SODA', 'TONIC', 'COCONUT', 'SHOPPING BAGS']);
const NOISE = new Set(['CAN', 'CANS', 'GL', 'GLS', 'GLAS', 'GLASS', 'PET', 'PLASTIC', 'PK', 'PACK', 'CT', 'WATER', 'BOTTLE', 'OZ', 'FL', 'C', 'P', 'W', 'O', 'GR', 'GM', 'AND', 'N']);
const SIZE_PACK_RE = /^(\d+(\.\d+)?(OZ|ML|L|GAL|G|CT|C|P|PK)?|\d+-\d+CT|\d+\/\d+.*|\.\d+.*)$/;
const CUT_LEN = 34; // catalog descriptions were cut at ~35 characters

/** Catalog text cut off right after a size's "O" ("…16.9O", "…12O") → read it as ounces. */
export function catalogText(p: Pick<Product, 'catalogName' | 'brand' | 'name' | 'variation' | 'sku'>): string {
  const raw = (p.catalogName || displayName(p as Product)).trim();
  return raw.length >= CUT_LEN && /\d\s?O$/i.test(raw) ? raw + 'Z' : raw;
}
const isVariety = (t: string) => /\b(VARIETY|VRTY|VPK)\b/.test(t);

function words(s: string): string[] {
  return tokens(s).filter((t) => !SIZE_PACK_RE.test(t));
}
function toOz(s: SizeInfo): number | null {
  return s.ml != null ? s.ml / ML_PER_OZ : null;
}

/** Size relation with the owner's tolerance: exact, close (≤ 0.3 oz), near (≤ 6 %), or different. */
export function compareSize(a: SizeInfo | null, b: SizeInfo | null): { rel: 'exact' | 'close' | 'near' | 'unknown' | 'diff'; deltaOz?: number } {
  if (!a || !b) return { rel: 'unknown' };
  if (a.grams != null || b.grams != null) return a.grams != null && b.grams != null && Math.abs(a.grams - b.grams) < 0.01 ? { rel: 'exact' } : { rel: 'diff' };
  const r = Math.abs(a.ml! - b.ml!) / Math.max(a.ml!, b.ml!);
  const d = Math.abs(toOz(a)! - toOz(b)!);
  if (r <= 0.005) return { rel: 'exact', deltaOz: d };
  if (d <= 0.3 + 1e-9) return { rel: 'close', deltaOz: d };
  if (r <= 0.06) return { rel: 'near', deltaOz: d };
  return { rel: 'diff', deltaOz: d };
}

function siblingKey(group: string, s: SizeInfo | null): string {
  return `${normText(group)}|${s ? (s.grams != null ? `${s.grams}G` : `${Math.round(s.ml! * 10) / 10}ML`) : '?'}`;
}
/** Same-group, same-size full case counts, used as context for counts cut off in the catalog. */
export function buildSiblingCounts(products: ProductLike[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const p of products) {
    const text = catalogText(p);
    const count = parsePack(canon(text))?.units;
    if (!count || isVariety(canon(text))) continue; // variety packs come in other case sizes
    const k = siblingKey(p.category || p.brand, parseSize(canon(text)));
    m.set(k, [...(m.get(k) || []), count]);
  }
  return m;
}

type CountRel = { rel: 'exact' | 'cutoff' | 'cutoff-weak' | 'structure' | 'unknown' | 'conflict'; note?: string };
function compareCount(p: ProductLike, pText: string, iText: string, ctx: MatchContext): CountRel {
  const iPack = parsePack(iText);
  if (!iPack) return { rel: 'unknown', note: 'Price line has no case count' };
  const raw = catalogText(p);
  const pPack = p.unitsPerCase != null ? { units: p.unitsPerCase, label: parsePack(pText)?.label ?? `${p.unitsPerCase}CT` } : parsePack(pText);
  if (pPack) {
    if (pPack.units !== iPack.units) return { rel: 'conflict', note: `Case count differs (${pPack.units} vs ${iPack.units})` };
    const pMulti = pPack.label.includes('-'), iMulti = iPack.label.includes('-');
    if (pMulti !== iMulti) return { rel: 'structure', note: iMulti ? `Price line is ${iPack.label} (multi-pack); catalog says ${pPack.units} per case` : `Catalog is a multi-pack (${pPack.label}); price line is ${iPack.units} per case` };
    return { rel: 'exact' };
  }
  // count not readable as a full count: was it cut off?  "…28OZ 12C", "…16OZ 1", "ZEPHYRHILLS 1.5L 12"
  const m = raw.match(/\s(\d+)\s?([A-Za-z]{0,2})$/);
  const size = parseSize(pText);
  const cut = raw.length >= CUT_LEN;
  const target = String(iPack.units);
  const sib = ctx.siblings?.get(siblingKey(p.category || p.brand, size)) || [];
  const siblingsAgree = sib.length >= 2 && sib.every((c) => c === iPack.units);
  if (m && size && !/^(OZ|ML|L|G|O|M|F|FL|GR)$/i.test(m[2])) {
    const digits = m[1];
    // "CORE POWER 42GR STRAWBERRY ELITE 14": the cut number could be the bottle size, not a count
    if (cut && !m[2] && size.ml == null) return { rel: 'unknown', note: `Catalog text cut off ("${digits}…") — case count not shown` };
    if (!cut || m[2]) {
      // the number is complete ("1.5L 12", "12C", "24P")
      if (digits === target) return { rel: cut ? 'cutoff' : 'exact', note: cut ? `Case count cut off in the catalog ("${m[0].trim()}") — reads as ${digits}` : undefined };
      return { rel: 'conflict', note: `Case count differs (${digits} vs ${iPack.units})` };
    }
    // only the first digit(s) survived
    if (!target.startsWith(digits)) return { rel: 'conflict', note: `Case count differs ("${digits}…" vs ${iPack.units})` };
    if (digits === target) return { rel: 'cutoff', note: `Case count cut off in the catalog ("${digits}") — matches ${iPack.units}` };
    if (siblingsAgree)
      return { rel: 'cutoff', note: `Case count cut off in the catalog ("${digits}…"); all ${sib.length} other ${size.label} products of this brand are ${iPack.units} per case` };
    return { rel: 'cutoff-weak', note: `Case count cut off in the catalog ("${digits}…") — could be ${iPack.units}` };
  }
  // the whole count was cut off ("GATORADE FROST GLACIER FREEZE 20OZ")
  if (cut && size && siblingsAgree) return { rel: 'cutoff', note: `Case count cut off in the catalog; all ${sib.length} other ${size.label} products of this brand are ${iPack.units} per case` };
  return { rel: 'unknown', note: 'Catalog does not show the case count' };
}

function brandRelation(p: ProductLike, item: PriceItem, pText: string): { rel: 'own' | 'type' | 'text' | 'none'; lead: string } {
  const alts = [...brandAlternatives(canon(item.brand))];
  if (!alts.length) alts.push(canon(item.brand));
  // "COCONUT WATER | VITA COCO 1L / 12CT": the words before the size name the brand too
  const lead = canon(item.desc).split(/\s\d|\s\//)[0].trim();
  const leadAlt = lead && !/\d/.test(lead) && !/^(STILL|SPARKLING|CAN|SMALL|MEDIUM|BIG|LIQUOR BAGS)$/.test(lead) && tokens(lead).length <= 3 ? lead : '';
  const pWords = tokens(pText);
  const contains = (alt: string) => {
    const at = tokens(alt);
    for (let i = 0; i + at.length <= pWords.length; i++) if (at.every((w, j) => pWords[i + j] === w)) return true;
    return false;
  };
  const pBrand = canon(p.brand || '');
  const compact = (s: string) => s.replace(/[^A-Z0-9]/g, '');
  const sameBrand = (alt: string) =>
    (brandAlternatives(pBrand).concat(pBrand)).some((o) => {
      if (!o) return false;
      const ot = tokens(o), at = tokens(alt);
      if (compact(o) === compact(alt)) return true;
      if (ot.length && ot.every((w) => at.includes(w))) return true; // "PERRIER" in "MAISON PERRIER"
      return compact(o).length >= 5 && editDistance(compact(o), compact(alt), 1) <= 1; // "ESSENTIAL" ~ "ESSENTIA"
    });
  const atStart = (alt: string) => tokens(alt).every((w, i) => pWords[i] === w);
  let rel: 'own' | 'type' | 'text' | 'none' = 'none';
  for (const alt of [...alts, ...(leadAlt ? [leadAlt] : [])]) {
    if (!alt) continue;
    if (TYPE_ALTS.has(alt)) {
      // "CANADA DRY CLUB CAN 12OZ" names the type without the word SODA
      const core = tokens(alt).filter((w) => w !== 'SODA' && w !== 'WATER').join(' ');
      if ((contains(alt) || (core && contains(core))) && rel === 'none') rel = 'type';
      continue;
    }
    if (pBrand ? sameBrand(alt) || atStart(alt) : contains(alt)) return { rel: pBrand ? 'own' : 'text', lead: leadAlt };
  }
  return { rel, lead: leadAlt };
}

/** Assess one price line for one product. Returns null when the line clearly isn't this product. */
export function assessCandidate(p: ProductLike, item: PriceItem, ctx: MatchContext = DEFAULT_CONTEXT): Candidate | null {
  const pText = canon(catalogText(p));
  const iText = canon(`${item.brand} ${item.desc}`);
  const flags: string[] = [];
  const notes: string[] = [];
  const make = (confidence: number, basis: Basis | null): Candidate => {
    const c = Math.max(0, Math.min(100, Math.round(confidence)));
    const verdict: Verdict = c >= 95 && !flags.length ? 'verified' : c >= 75 ? 'suggested' : 'nomatch';
    return { item, confidence: c, verdict, basis: verdict === 'verified' ? basis : null, flags: [...flags], notes: [...notes], score: c / 100, strong: verdict === 'verified', evidence: true, reasons: [...flags, ...notes] };
  };
  if (p.sku && item.sku && p.sku.trim().toUpperCase() === item.sku.trim().toUpperCase()) return make(100, 'sku');

  // 1. brand
  const br = brandRelation(p, item, pText);
  if (br.rel === 'none') return null;
  let cap = 100;
  const capTo = (n: number) => (cap = Math.min(cap, n));
  if (br.rel === 'type') {
    flags.push(`Price line "${item.brand}" does not name the brand ${p.brand ? `(${p.brand})` : ''}`.replace(' ()', ''));
    capTo(85);
  }

  // 2. product type / variation
  const pT = new Set(tokens(pText).map((w) => (w === 'SPORTS' ? 'SPORT' : w === 'ALKLINE' ? 'ALKALINE' : w === 'VRTY' || w === 'VPK' ? 'VARIETY' : w)));
  const iT = new Set(tokens(iText).map((w) => (w === 'SPORTS' ? 'SPORT' : w)));
  if ((pT.has('STILL') && iT.has('SPARKLING')) || (pT.has('SPARKLING') && iT.has('STILL'))) return null;
  if (pT.has('ALKALINE') && !iT.has('ALKALINE')) (flags.push('Alkaline water — the price sheet lists only regular'), capTo(90));
  if (pT.has('VARIETY') && !iT.has('VARIETY')) (flags.push('Variety pack — the price sheet lists a regular case'), capTo(90));
  if (iT.has('SPORT') && !pT.has('SPORT')) (flags.push('Price line is the sport-cap bottle; the catalog does not say sport'), capTo(90));
  if (pT.has('SPORT') && !iT.has('SPORT')) (flags.push('Catalog says sport cap; the price line does not'), capTo(90));
  if ((iT.has('STILL') || iT.has('SPARKLING')) && !pT.has('STILL') && !pT.has('SPARKLING')) (flags.push('Price line is still/sparkling-specific; the catalog does not say which'), capTo(85));
  for (const q of ['JUICE', 'TEA']) {
    if (tokens(canon(item.brand)).includes(q) && !pT.has(q)) (flags.push(`Price line is for ${item.brand} — the catalog product is not called ${q.toLowerCase()}`), capTo(85));
  }
  const pPkg = parsePackaging(pText), iPkg = parsePackaging(iText);
  if (pPkg && iPkg && pPkg !== iPkg) return null;
  // the words the price line uses to narrow the product ("PARROT", "PINEAPPLE JUICE", "CAN") must be in the catalog name
  const descWords = words(canon(item.desc)).filter((w) => !['SPORT', 'SPORTS', 'PLASTIC', 'GLASS', 'CAN'].includes(w));
  const missingLead = descWords.filter((w) => !pT.has(w));
  if (missingLead.length) (flags.push(`Price line says "${missingLead.join(' ')}"; the catalog name does not`), capTo(80));

  // 3. size
  const ps = parseSize(pText), is = parseSize(iText);
  const sz = compareSize(ps, is);
  if (sz.rel === 'diff') return null;
  if (sz.rel === 'close') (flags.push(`Size differs by ${sz.deltaOz!.toFixed(1)} oz (${ps!.label} vs ${is!.label})`), capTo(92));
  if (sz.rel === 'near') (flags.push(`Size differs by ${sz.deltaOz!.toFixed(1)} oz (${ps!.label} vs ${is!.label}) — more than 0.3 oz`), capTo(sz.deltaOz! <= 1 ? 84 : 78));
  if (sz.rel === 'unknown') (flags.push(ps ? 'Price line has no size' : 'Catalog does not show the size'), capTo(80));
  if (sz.rel === 'exact' && ps && is && ps.label !== is.label) notes.push(`Same size written differently (${ps.label} = ${is.label})`);
  if (/\d0Z\b|\dOOZ\b/i.test(p.catalogName || '')) notes.push('Catalog typo read as ounces ("0Z" → "OZ")');

  // 4. case count
  const cnt = compareCount(p, pText, iText, ctx);
  if (cnt.rel === 'conflict') (flags.push(cnt.note!), capTo(55));
  if (cnt.rel === 'structure') (flags.push(cnt.note!), capTo(89));
  if (cnt.rel === 'cutoff-weak') (flags.push(cnt.note!), capTo(88));
  if (cnt.rel === 'unknown') (flags.push(cnt.note!), capTo(80));
  if (cnt.rel === 'cutoff') notes.push(cnt.note!);

  // packaging stated on one side only
  if (iPkg && !pPkg) {
    // words this line shares with the catalog name beyond the brand ("COKE MEXICO" ↔ "COKE MEXICO 355ML"):
    // a less specific line (no "MEXICO") is not a competing packaging
    const own = new Set(tokens(canon(p.brand || '')));
    const specific = words(iText).filter((w) => !own.has(w) && pT.has(w));
    const others = (ctx.items || []).filter((o) => {
      if (o.id === item.id) return false;
      const oText = canon(`${o.brand} ${o.desc}`);
      return brandRelation(p, o, pText).rel === 'own' && compareSize(ps, parseSize(oText)).rel === 'exact' && specific.every((w) => tokens(oText).includes(w));
    });
    if (others.length) (flags.push(`Price line is ${iPkg}; the catalog does not say, and another packaging exists for this size`), capTo(85));
    else notes.push(`Price line says ${iPkg}; the catalog does not — it is the only line of this brand for this size`);
  }
  if (pPkg && !iPkg) notes.push(`Catalog says ${pPkg}; the price line does not`);

  // 5. flavor / variety words that the price line doesn't name
  const brandWords = new Set([...tokens(canon(p.brand || '')), ...tokens(canon(p.category || ''))]);
  const extra = words(pText).filter((w) => !iT.has(w) && !brandWords.has(w) && !NOISE.has(w) && !['ALKALINE', 'VARIETY', 'SPORT', 'SPORTS', 'STILL', 'SPARKLING'].includes(w) && w.length > 1);
  let basis: Basis = notes.some((n) => n.startsWith('Case count cut off')) ? 'count-cut-off' : notes.length ? 'naming' : 'exact';
  let conf = basis === 'exact' ? 100 : basis === 'naming' ? 97 : 95;
  if (extra.length) {
    if (tokens(canon(item.brand)).includes('FLAVORS')) {
      basis = 'flavors-listed';
      conf = Math.min(conf, 98);
      notes.push(`Flavor/variety "${extra.join(' ')}" — the price line says "& FLAVORS"`);
    } else if (ctx.brandLevelFlavors) {
      if (basis !== 'count-cut-off') basis = 'brand-level';
      conf = Math.min(conf, 96);
      notes.push(`Flavor/variety "${extra.join(' ')}" — one price for the brand at this size and count`);
    } else {
      flags.push(`Flavor/variety "${extra.join(' ')}" is not named on the price sheet`);
      capTo(90);
    }
  }
  return make(Math.min(conf, cap), basis);
}

/** Kept for older callers. */
export const scoreCandidate = (p: ProductLike, item: PriceItem, ctx: MatchContext = DEFAULT_CONTEXT) => assessCandidate(p, item, ctx);

export function rankCandidates(p: ProductLike, items: PriceItem[], limit = 8, ctx: MatchContext = DEFAULT_CONTEXT): Candidate[] {
  const c2: MatchContext = { ...ctx, items: ctx.items ?? items };
  const out: Candidate[] = [];
  for (const it of items) {
    const c = assessCandidate(p, it, c2);
    if (c) out.push(c);
  }
  // two different lines that both fully fit → neither is verified
  const verified = out.filter((c) => c.verdict === 'verified');
  if (verified.length > 1) {
    for (const c of verified) {
      c.flags.push(`${verified.length} price lines fit equally (${verified.map((v) => `${v.item.brand} ${v.item.desc}`).join(' / ')})`);
      c.confidence = Math.min(c.confidence, 85);
      c.verdict = 'suggested';
      c.basis = null;
      c.strong = false;
      c.score = c.confidence / 100;
      c.reasons = [...c.flags, ...c.notes];
    }
  }
  out.sort((x, y) => y.confidence - x.confidence || x.flags.length - y.flags.length);
  return out.slice(0, limit);
}

export interface MatchResult {
  status: MatchStatus;
  priceItemId: string | null;
  suggestedPriceItemId: string | null;
  method: string; // 'manual' | 'sku' | 'auto' | ''
  score: number; // 0..1 (confidence / 100)
  confidence: number;
  basis: Basis | null;
  flags: string[];
  notes: string[];
  candidates: Candidate[];
}

export function matchProduct(p: ProductLike, items: PriceItem[], mappings: Map<string, Mapping>, ctx: MatchContext = DEFAULT_CONTEXT): MatchResult {
  const saved = mappings.get(mappingKey(p));
  const none = { flags: [] as string[], notes: [] as string[], basis: null, candidates: [] as Candidate[] };
  if (saved && saved.source !== 'rule90') {
    // decided by hand — always kept
    if (saved.priceItemKey === null) return { ...none, status: 'unmatched', priceItemId: null, suggestedPriceItemId: null, method: saved.source || 'manual', score: 0, confidence: 0 };
    const it = items.find((i) => i.key === saved.priceItemKey);
    // 'owner80' = the owner's "accept everything above 80%" decision (v6); otherwise confirmed in the app
    if (it) return { ...none, status: 'matched', priceItemId: it.id, suggestedPriceItemId: null, method: saved.source || 'manual', score: 1, confidence: 100 };
    // the chosen line no longer exists → automatic matching below (never silently matched)
  }
  const cands = rankCandidates(p, items, 8, ctx);
  const best = cands[0];
  if (best && best.verdict === 'verified') {
    return { status: 'matched', priceItemId: best.item.id, suggestedPriceItemId: null, method: best.basis === 'sku' ? 'sku' : 'auto', score: best.score, confidence: best.confidence, basis: best.basis, flags: best.flags, notes: best.notes, candidates: cands };
  }
  if (best && best.verdict === 'suggested') {
    return { status: 'review', priceItemId: null, suggestedPriceItemId: best.item.id, method: '', score: best.score, confidence: best.confidence, basis: null, flags: best.flags, notes: best.notes, candidates: cands };
  }
  // below 75: unmatched; the closest line is kept only as information
  return { status: 'unmatched', priceItemId: null, suggestedPriceItemId: best?.item.id ?? null, method: '', score: best?.score ?? 0, confidence: best?.confidence ?? 0, basis: null, flags: best?.flags ?? [], notes: best?.notes ?? [], candidates: cands };
}

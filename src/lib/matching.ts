/**
 * Catalog product ⇄ price sheet matching.
 *
 * Order of evidence: saved manual mapping → exact SKU → brand + size + case count
 * (+ packaging / variant words) → fuzzy text similarity.
 * A price is only assigned automatically when exactly ONE price line is a strong,
 * unambiguous match. Anything else becomes 'review' (with a suggestion) or 'unmatched'.
 */
import type { Mapping, MatchStatus, PriceItem, Product } from '../types';
import { brandAlternatives, editDistance, normText, parsePack, parsePackaging, parseSize, sizeRelation, tokens, variantWords } from './normalize';
import { displayName, mappingKey } from './products';

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
export function canon(s: string): string {
  let t = normText(s);
  for (const [re, rep] of ALIASES) t = t.replace(re, rep);
  return t;
}

type ProductLike = Pick<Product, 'brand' | 'name' | 'variation' | 'sku' | 'unitsPerCase' | 'catalogName'>;

export interface Candidate {
  item: PriceItem;
  score: number; // 0..1
  strong: boolean;
  evidence: boolean; // brand or wording actually agree (size + case count alone is not evidence)
  reasons: string[];
}

const SIZE_PACK_RE = /^(\d+(\.\d+)?(OZ|ML|L|GAL|G|CT)|\d+-\d+CT|\d+)$/;

function contentTokens(s: string): string[] {
  return tokens(s).filter((t) => !SIZE_PACK_RE.test(t));
}

export function scoreCandidate(p: ProductLike, item: PriceItem): Candidate | null {
  const pText = canon(p.catalogName || displayName(p));
  const iText = canon(`${item.brand} ${item.desc}`);
  const reasons: string[] = [];

  if (p.sku && item.sku && p.sku.trim().toUpperCase() === item.sku.trim().toUpperCase()) {
    return { item, score: 1, strong: true, evidence: true, reasons: ['Same SKU'] };
  }

  // size — a clear conflict rules the line out; a near size (8.4OZ vs 8OZ) can only be suggested
  const rel = sizeRelation(parseSize(pText), parseSize(iText));
  if (rel === 'diff') return null;
  const sz = rel === 'same' ? true : null;
  if (rel === 'near') reasons.push(`Size close but not identical (${parseSize(pText)!.label} vs ${parseSize(iText)!.label})`);
  // units per case — a conflict rules the line out
  const pUnits = p.unitsPerCase ?? parsePack(pText)?.units ?? null;
  const iUnits = parsePack(iText)?.units ?? null;
  const pk = pUnits != null && iUnits != null ? pUnits === iUnits : null;
  if (pk === false) return null;
  // packaging (glass / can / plastic)
  const pPkg = parsePackaging(pText), iPkg = parsePackaging(iText);
  if (pPkg && iPkg && pPkg !== iPkg) return null;
  // variant words (still / sparkling / sport / diet / zero)
  const pVar = variantWords(pText), iVar = variantWords(iText);
  if ((pVar.includes('STILL') && iVar.includes('SPARKLING')) || (pVar.includes('SPARKLING') && iVar.includes('STILL'))) return null;

  // brand
  const pTok = new Set(tokens(pText));
  const has = (t: string) => pTok.has(t) || (t.length >= 5 && [...pTok].some((x) => x.length >= 5 && editDistance(x, t, 1) <= 1));
  let brand = 0;
  const alts = brandAlternatives(canon(item.brand));
  if (!alts.length) alts.push(canon(item.brand));
  // lines like "COCONUT WATER | VITA COCO 1L / 12CT": the words before the size name the brand too
  const lead = canon(item.desc).split(/\s\d|\s\//)[0].trim();
  if (lead && !/\d/.test(lead) && !/^(STILL|SPARKLING|CAN|SMALL|MEDIUM|BIG|LIQUOR BAGS)$/.test(lead) && tokens(lead).length <= 3) alts.push(lead);
  const pBrand = canon(p.brand || '');
  if (pBrand) {
    // The product states its brand (catalog "Group"): the price line must be for that brand,
    // or name it at the very start of the description. A flavour word ("RED BULL WATERMELON",
    // "BAI COCONUT") is never treated as the brand.
    const own = brandAlternatives(pBrand).concat(pBrand);
    const compact = (s: string) => s.replace(/[^A-Z0-9]/g, '');
    const pWords = tokens(pText);
    for (const alt of alts) {
      const at = tokens(alt);
      if (!at.length) continue;
      const sameBrand = own.some((o) => {
        const ot = tokens(o);
        if (compact(o) === compact(alt)) return true;
        if (ot.length && ot.every((w) => at.includes(w))) return true; // "PERRIER" in "MAISON PERRIER"
        return compact(o).length >= 5 && editDistance(compact(o), compact(alt), 1) <= 1; // "ESSENTIAL" ~ "ESSENTIA"
      });
      const atStart = at.every((w, i) => pWords[i] === w);
      if (sameBrand || atStart) brand = 1;
    }
  } else {
    for (const alt of alts) {
      const at = tokens(alt);
      if (!at.length) continue;
      const frac = at.filter(has).length / at.length;
      brand = Math.max(brand, frac === 1 ? 1 : frac * 0.7);
    }
  }
  if (brand >= 1) reasons.push('Brand matches');
  if (sz) reasons.push('Same size');
  if (pk) reasons.push('Same case count');

  // remaining words (flavour, product line, "PARROT" vs "VITA COCO", ...)
  const a = new Set(contentTokens(pText)), b = new Set(contentTokens(iText));
  const inter = [...b].filter((t) => a.has(t)).length;
  const textSim = b.size ? inter / b.size : 0;
  const descWords = contentTokens(canon(item.desc));
  const descOk = descWords.every((w) => a.has(w) || w === 'SPORT' || w === 'SPORTS' || w === 'PLASTIC' || w === 'GLASS' || w === 'CAN');

  const score = 0.45 * brand + 0.25 * (sz === true ? 1 : sz === null ? 0.3 : 0) + 0.15 * (pk === true ? 1 : pk === null ? 0.3 : 0) + 0.15 * textSim;

  const pkgAmbiguous = !!iPkg && !pPkg;
  // "12OZ / 2-12CT" (two 12-packs) vs a product that just says "24CT": same total, maybe not the same item
  const iMulti = !!parsePack(iText)?.label.includes('-');
  const pMulti = !!parsePack(pText)?.label.includes('-');
  if (iMulti !== pMulti && pk) reasons.push(iMulti ? 'Price line is a multi-pack' : 'Product is a multi-pack');
  const variantAmbiguous = iVar.some((v) => !pVar.includes(v)) || pVar.some((v) => !iVar.includes(v));
  const strong = brand >= 1 && sz === true && pk === true && descOk && !pkgAmbiguous && !variantAmbiguous && iMulti === pMulti;
  if (pkgAmbiguous) reasons.push(`Price line is ${iPkg}; product doesn't say`);
  if (variantAmbiguous) reasons.push('Variant words differ');
  const evidence = brand >= 1 || textSim >= 0.5;
  return { item, score: Math.round(score * 1000) / 1000, strong, evidence, reasons };
}

export interface MatchResult {
  status: MatchStatus;
  priceItemId: string | null;
  suggestedPriceItemId: string | null;
  method: string;
  score: number;
  candidates: Candidate[];
}

export const AUTO_MIN_SCORE = 0.85;
export const REVIEW_MIN_SCORE = 0.45;

export function rankCandidates(p: ProductLike, items: PriceItem[], limit = 8): Candidate[] {
  const out: Candidate[] = [];
  for (const it of items) {
    const c = scoreCandidate(p, it);
    if (c && c.score > 0.2) out.push(c);
  }
  out.sort((x, y) => Number(y.strong) - Number(x.strong) || Number(y.evidence) - Number(x.evidence) || y.score - x.score);
  return out.slice(0, limit);
}

export function matchProduct(p: ProductLike, items: PriceItem[], mappings: Map<string, Mapping>): MatchResult {
  const saved = mappings.get(mappingKey(p));
  if (saved) {
    if (saved.priceItemKey === null) return { status: 'unmatched', priceItemId: null, suggestedPriceItemId: null, method: 'manual', score: 0, candidates: [] };
    const it = items.find((i) => i.key === saved.priceItemKey);
    if (it) return { status: 'matched', priceItemId: it.id, suggestedPriceItemId: null, method: saved.source === 'rule90' ? 'rule90' : 'manual', score: 1, candidates: [] };
    // the mapped line no longer exists — fall through to automatic matching (never silently matched)
  }
  const cands = rankCandidates(p, items);
  const strong = cands.filter((c) => c.strong && c.score >= AUTO_MIN_SCORE);
  if (strong.length === 1 && !(saved && saved.priceItemKey)) {
    const c = strong[0];
    return { status: 'matched', priceItemId: c.item.id, suggestedPriceItemId: null, method: c.reasons[0] === 'Same SKU' ? 'sku' : 'auto', score: c.score, candidates: cands };
  }
  const best = cands[0];
  if (best && best.evidence && best.score >= REVIEW_MIN_SCORE) {
    return { status: 'review', priceItemId: null, suggestedPriceItemId: best.item.id, method: '', score: best.score, candidates: cands };
  }
  return { status: 'unmatched', priceItemId: null, suggestedPriceItemId: null, method: '', score: best?.score ?? 0, candidates: cands };
}

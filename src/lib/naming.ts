/**
 * Clean, standardized product names for catalog products (owner request 2026-11-22):
 *   "PEPSI DIET 2/12 12OZ"           → "PEPSI DIET" · "12 OZ / 24 CT (2 × 12)"
 *   "BODY ARMOUR TROPICAL PUNCH 16OZ 12C" → "BODYARMOR TROPICAL PUNCH" · "16 OZ / 12 CT"
 * Only spelling and formatting change — never the product's identity, size or count. Everything comes
 * from the catalog line itself (plus the reviewed corrections in src/data/catalogCorrections.ts); where the
 * catalog text was cut off, the missing part is simply not shown (nothing is guessed). The original
 * catalog text stays the product's key and stays searchable.
 */
import { normText, parsePack, parseSize } from './normalize';
import { CATALOG_CORRECTIONS } from '../data/catalogCorrections';

// spelling fixes (whole words)
const WORD_FIX: Record<string, string> = {
  VANILA: 'VANILLA', VANILABERRY: 'VANILLA BERRY', CAREMAL: 'CARAMEL', RASBERRY: 'RASPBERRY', RASBEERY: 'RASPBERRY',
  STRAWBEERY: 'STRAWBERRY', STRWABERRY: 'STRAWBERRY', STARWBERRY: 'STRAWBERRY', PINAPPLE: 'PINEAPPLE', HAWAIAN: 'HAWAIIAN',
  ARTIC: 'ARCTIC', COCONUR: 'COCONUT', APPRICOT: 'APRICOT', POMOGRANATE: 'POMEGRANATE', TROPICCAL: 'TROPICAL', COTTAN: 'COTTON',
  MOCAH: 'MOCHA', CHOT: 'SHOT', DBL: 'DOUBLE', GRREN: 'GREEN', ALKLINE: 'ALKALINE', SMOOTHY: 'SMOOTHIE', TAMARINOO: 'TAMARINDO',
  CHILZICLE: 'CHILLZICLE', BLIS: 'BLISS', SPARKING: 'SPARKLING', NESQUICK: 'NESQUIK', FRAPPUCHINE: 'FRAPPUCCINO',
  FRAPPUCINO: 'FRAPPUCCINO', SCHWEEPS: 'SCHWEPPES', UNSWEETEN: 'UNSWEETENED', LMND: 'LEMONADE', VRTY: 'VARIETY',
  VPK: 'VARIETY PACK', TALLBOY: 'TALL BOY', GL: 'GLASS', GLS: 'GLASS', GLAS: 'GLASS', SPTK: 'SOUR PATCH KIDS', ENE: 'ENERGY', ULT: 'ULTIMATE',
  ENERGYCHERRY: 'ENERGY CHERRY', ENERGYJUICY: 'ENERGY JUICY', ENERGYSUMMER: 'ENERGY SUMMER', MALT: 'MALT',
  // words the catalog cut off at its 35-character limit, completed only where the word is unambiguous
  STRAWBER: 'STRAWBERRY', CITRU: 'CITRUS', LEMONA: 'LEMONADE', APPRICOTT: 'APRICOT',
};
// brand spelling (whole name parts)
const BRAND_FIX: [RegExp, string][] = [
  [/\bBODY ARMOU?R\b/, 'BODYARMOR'],
  [/^ESSENTIAL\b/, 'ESSENTIA'],
  [/^AW\b/, 'A&W'],
  [/\bVITA MALT\b(?! ?A)/, 'VITA MALTA'],
];
const SIZE_RE = /^(\d+(\.\d+)?|\.\d+)(OZ|ML|L|GAL|G|GR|GM|FL|FLOZ)$/;
const COUNT_RE = /^(\d+)(CT|PK|PACK|C|P)$|^\d+[/-]\d+([/-]\d+)?(CT|PK|PACK|C|P)?$|^\d+\/$/;

function fmtSize(label: string): string {
  return label.replace(/^\./, '0.').replace(/^(\d+\.\d*?)0+(?=[A-Z])/, '$1').replace(/\.(?=[A-Z])/, '').replace(/^(\d+(?:\.\d+)?)\s*(FL ?OZ|OZ)$/, '$1 OZ').replace(/^(\d+(?:\.\d+)?)(ML|L|GAL|G)$/, '$1 $2');
}

export interface StandardName {
  title: string; // brand + product, e.g. "PEPSI DIET"
  size: string; // "12 OZ / 24 CT (2 × 12)" ('' when the catalog does not show it)
  full: string; // "PEPSI DIET — 12 OZ / 24 CT (2 × 12)"
}

const cache = new Map<string, StandardName>();

/** Standardized name for a catalog product, from its original catalog line. */
export function standardName(catalogLine: string, group = ''): StandardName {
  const key = `${group}\u0001${catalogLine}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = catalogLine.trim();
  let res: StandardName;
  if (!raw || /plastic bags/i.test(group)) {
    res = { title: raw, size: '', full: raw }; // "1/10" on bags is a bag size: keep as printed
  } else {
    const corr = CATALOG_CORRECTIONS[raw];
    // the catalog cut lines at ~35 characters: "…20O" is "…20OZ"
    const text = normText(raw.length >= 34 && /\d\s?O$/i.test(raw) ? `${raw}Z` : raw).replace(/(\d)\s+(OZ|ML|L|FL OZ|FL)\b/g, '$1$2').replace(/\bFL ?OZ\b/g, 'OZ').replace(/(\d)FL\b/g, '$1OZ');
    const toks = text.split(/\s+/).filter(Boolean);
    const sizes = toks.filter((t) => SIZE_RE.test(t));
    const vol = sizes.find((t) => !/(G|GR|GM)$/.test(t)) || null;
    const sizeInfo = vol ? parseSize(vol.replace(/FLOZ$/, 'OZ')) : null;
    const pack = parsePack(text);
    // product words: drop the volume and count tokens and cut-off number fragments at the end
    const words: string[] = [];
    toks.forEach((t, i) => {
      if (t === vol || COUNT_RE.test(t)) return;
      if (/^\d+[A-Z]?$/.test(t) && i === toks.length - 1 && raw.length >= 34) return; // "…16OZ 1" (cut-off count)
      if (/^[A-Z]$/.test(t) && i === toks.length - 1 && raw.length >= 34) return; // "…1/12 C" (cut-off "CT")
      if (/^\d+$/.test(t) && i === toks.length - 1 && vol) return; // "ZEPHYRHILLS 1.5L 12" → count, not a name word
      if (/^(\d+)(G|GR|GM)$/.test(t)) return words.push(t.replace(/(GR|GM)$/, 'G')); // protein grams stay in the name
      words.push(...(WORD_FIX[t] ?? t).split(' '));
    });
    let title = words.join(' ').replace(/\s*-\s*$/, '').replace(/\bCAN-/g, 'CAN ').replace(/\bVARIETY PK\b/g, 'VARIETY PACK').replace(/\s+/g, ' ').trim();
    for (const [re, rep] of BRAND_FIX) title = title.replace(re, rep);
    const sizeText = corr?.size ?? (sizeInfo ? fmtSize(sizeInfo.label) : '');
    // count: a full count printed in the catalog, or a trailing bare number ("1.5L 12"); never guessed
    let count = corr?.count ?? pack?.units ?? null;
    if (count == null) {
      // "…12OZ 24C" / "…24P": the count's digits are complete, only "CT"/"PK" was cut off
      const cut = toks.find((t) => /^(\d+)(C|P)$/.test(t));
      if (cut) count = parseInt(cut, 10);
    }
    if (count == null && vol) {
      const last = toks[toks.length - 1];
      if (/^\d+$/.test(last) && last !== vol && raw.length < 34) count = +last;
    }
    let structure = '';
    if (!corr?.count && pack && /^(\d+)-(\d+)/.test(pack.label)) {
      const [, a, b] = pack.label.match(/^(\d+)-(\d+)/)!;
      if (+a > 1) structure = ` (${a} × ${b})`;
    }
    const size = [sizeText, count ? `${count} CT${structure}` : ''].filter(Boolean).join(' / ');
    res = { title, size, full: size ? `${title} — ${size}` : title };
  }
  cache.set(key, res);
  return res;
}

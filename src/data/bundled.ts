/**
 * Data that ships inside the app.
 *
 * Each dataset has a version number. When the app starts it applies, in order, every
 * dataset newer than the version already applied on this phone (Settings.bundledVersion),
 * using the same safe import as the Settings screen: prices and names are updated,
 * new products are added, NOTHING is deleted, and stores / carts / orders are untouched.
 *
 * To ship an updated price sheet or a catalog: add a new entry with version = last + 1.
 * Never change or remove an entry that has already been published.
 */
import type { CatalogRowInput, PriceRowInput } from '../db/importer';
import type { Settings } from '../types';
import { parseMoneyToCents } from '../lib/money';
import { unitsFromText } from '../lib/products';
import { A2Z_PRICE_ROWS, A2Z_SOURCE_FILE } from './a2zPriceSheet';
import { A2Z_CATALOG_FILE, A2Z_CATALOG_ROWS, brandForGroup, splitDescription } from './a2zCatalog';
import { ACCEPTED_80, ACCEPTED_90 } from './acceptedMatches';
import { OWNER_DOC_FILE, OWNER_DOC_MATCHES } from './ownerMatchedPrices';

/** A verified catalog-product → price-sheet-line link (checked by a person, not guessed). */
export interface BundledMapping {
  catalogRaw: string; // the catalog row's `raw` text (or use sku)
  sku?: string;
  priceBrand: string | null; // null = known to have no price line
  priceDesc: string | null;
  source?: string; // e.g. 'rule90'
}

export type BundledDataset =
  | { version: number; kind: 'pricesheet'; fileName: string; rows: PriceRowInput[] }
  | { version: number; kind: 'catalog'; fileName: string; rows: CatalogRowInput[]; mappings?: BundledMapping[] }
  // links between catalog products and price lines (decisions you already made by hand are never overwritten)
  | { version: number; kind: 'mappings'; fileName: string; mappings: BundledMapping[] }
  // re-run price matching for every catalog product with the current rules (hand decisions are kept)
  | { version: number; kind: 'rematch'; fileName: string }
  // settings values applied only where the setting is still empty (never overwrites what you typed)
  | { version: number; kind: 'settings'; fileName: string; fillEmpty: Partial<Pick<Settings, 'repName' | 'repPhone' | 'companyName' | 'companyAddress' | 'companyPhone'>> };

export const BUNDLED_DATASETS: BundledDataset[] = [
  {
    version: 1,
    kind: 'pricesheet',
    fileName: A2Z_SOURCE_FILE,
    rows: A2Z_PRICE_ROWS.map(([section, brand, desc, price]) => ({
      section,
      brand,
      desc,
      priceCents: parseMoneyToCents(price)!,
      raw: `${brand} | ${desc} | $${price}`,
    })),
  },
  {
    version: 2,
    kind: 'catalog',
    fileName: A2Z_CATALOG_FILE,
    rows: A2Z_CATALOG_ROWS.map(([department, group, desc]) => {
      const { name, variation } = splitDescription(desc);
      return {
        department,
        category: group,
        brand: brandForGroup(group, desc),
        name,
        variation,
        unitsPerCase: group === 'Plastic bags' ? null : unitsFromText(desc), // "1/10" on bags is a bag size, not a count
        sku: '',
        raw: desc,
      };
    }),
    // No pre-confirmed links: every catalog product priced automatically passed the strict
    // brand + size + case-count rules; everything uncertain is left for review in the app.
    mappings: [],
  },
  {
    version: 3,
    kind: 'settings',
    fileName: 'Representative phone (owner request, 2026-11-21)',
    fillEmpty: { repPhone: '+1 561-552-6556' },
  },
  {
    version: 4,
    kind: 'mappings',
    fileName: 'Owner rule 2026-11-21: accept suggested prices scoring 90% or more',
    mappings: ACCEPTED_90.map(([catalogRaw, priceBrand, priceDesc]) => ({ catalogRaw, priceBrand, priceDesc, source: 'rule90' })),
  },
  {
    // Owner's verification policy (2026-11-21) replaces the blanket 90% rule: brand → product type →
    // size (≤ 0.3 oz = flagged) → exact case count; material differences (alkaline, variety pack,
    // sport cap, multi-pack, a different product line) are never verified. Prices accepted by the
    // 90% rule are re-checked; decisions made by hand are never touched. See tests/tool-audit.test.ts.
    version: 5,
    kind: 'rematch',
    fileName: 'Owner verification policy 2026-11-21: full re-check of every catalog price',
  },
  {
    // Owner decision after the v5 re-check: "accept everything above 80% for prices, I checked it manually".
    // Stored as his own confirmations (decisions he already made by hand in the app are never overwritten).
    version: 6,
    kind: 'mappings',
    fileName: 'Owner decision 2026-11-21: accept every suggested price above 80% (checked by him)',
    mappings: ACCEPTED_80.map(([catalogRaw, priceBrand, priceDesc]) => ({ catalogRaw, priceBrand, priceDesc, source: 'owner80' })),
  },
  {
    // Owner's matched-prices document, verified against the price sheet (see ownerMatchedPrices.ts):
    // 20 products priced from it, 7 that it lists as NO PRICE → "Price not added". Hand decisions kept.
    version: 7,
    kind: 'mappings',
    fileName: OWNER_DOC_FILE,
    mappings: OWNER_DOC_MATCHES.map(([catalogRaw, priceBrand, priceDesc]) => ({ catalogRaw, priceBrand, priceDesc, source: 'ownerdoc' })),
  },
  // Next: { version: 8, kind: 'catalog' | 'pricesheet' | 'settings' | 'mappings' | 'rematch', ... }
];

export const LATEST_BUNDLED_VERSION = Math.max(...BUNDLED_DATASETS.map((d) => d.version));

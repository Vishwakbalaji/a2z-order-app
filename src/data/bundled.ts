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

/** A verified catalog-product → price-sheet-line link (checked by a person, not guessed). */
export interface BundledMapping {
  catalogRaw: string; // the catalog row's `raw` text (or use sku)
  sku?: string;
  priceBrand: string | null; // null = known to have no price line
  priceDesc: string | null;
}

export type BundledDataset =
  | { version: number; kind: 'pricesheet'; fileName: string; rows: PriceRowInput[] }
  | { version: number; kind: 'catalog'; fileName: string; rows: CatalogRowInput[]; mappings?: BundledMapping[] }
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
  // Next: { version: 4, kind: 'catalog' | 'pricesheet' | 'settings', ... }
];

export const LATEST_BUNDLED_VERSION = Math.max(...BUNDLED_DATASETS.map((d) => d.version));

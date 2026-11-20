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
import { parseMoneyToCents } from '../lib/money';
import { A2Z_PRICE_ROWS, A2Z_SOURCE_FILE } from './a2zPriceSheet';

/** A verified catalog-product → price-sheet-line link (checked by a person, not guessed). */
export interface BundledMapping {
  catalogRaw: string; // the catalog row's `raw` text (or use sku)
  sku?: string;
  priceBrand: string | null; // null = known to have no price line
  priceDesc: string | null;
}

export type BundledDataset =
  | { version: number; kind: 'pricesheet'; fileName: string; rows: PriceRowInput[] }
  | { version: number; kind: 'catalog'; fileName: string; rows: CatalogRowInput[]; mappings?: BundledMapping[] };

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
  // Next: { version: 2, kind: 'catalog', fileName: '...', rows: CATALOG_ROWS, mappings: VERIFIED_MAPPINGS },
];

export const LATEST_BUNDLED_VERSION = Math.max(...BUNDLED_DATASETS.map((d) => d.version));

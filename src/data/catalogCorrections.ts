/**
 * Reviewed corrections for catalog lines whose size or count is missing or wrong in the printed catalog.
 * Keyed by the original catalog text (never changed). Each one cites its evidence.
 */
export interface CatalogCorrection {
  size?: string; // as displayed, e.g. "8.4 OZ"
  count?: number;
  note: string;
}

export const CATALOG_CORRECTIONS: Record<string, CatalogCorrection> = {
  // Red Bull's U.S. product page lists the Amber Edition (strawberry-apricot) in 8.4 fl oz and 12 fl oz
  // (redbull.com/us-en/energydrink/products/red-bull-amber-edition). The catalog already has the 12 oz as
  // "RED BULL AMBER APPRICOT 12OZ 24CT", so this unsized line is the 8.4 oz; Red Bull 8.4 oz cases are 24
  // (price sheet "RED BULL 8OZ / 24CT").
  'RED BULL AMBER STRAWBERRY APPRICOT': {
    size: '8.4 OZ',
    count: 24,
    note: 'Size not printed in the catalog. Red Bull U.S. sells Amber in 8.4 oz and 12 oz; the 12 oz is a separate catalog product, so this is the 8.4 oz.',
  },
  // Case count not printed; the owner's price list (A2Z_Mismatch_With_Prices.pdf) gives "RED BULL VARIETY PACK — 8.4 OZ / 24 CT".
  // Count cut to "24" in the catalog; the owner's note "PRICE OF PEPSI, MOUNTAIN DEW, AND Dr PEPPER: 20 OZ 24 - $25.99".
  'DR PEPPER STRAWBERRY CREAM 20 OZ 24': { count: 24, note: 'Case count shown as "24" in the catalog; your price note says 20 OZ 24.' },
  'RED BULL VARIETY PK IVB WP CS 8.4OZ': { count: 24, note: 'Case count from your price list (8.4 oz / 24 ct).' },
};

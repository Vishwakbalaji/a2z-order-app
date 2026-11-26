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
  // The owner's corrected catalog (A2Z_Corrected_Full_Catalog.pdf, 2026-11-26) writes "12 OZ 24CT" next to this line
  // (red) at $54.99. (Earlier this was read as 8.4 oz from redbull.com — his document wins.)
  'RED BULL AMBER STRAWBERRY APPRICOT': { size: '12 OZ', count: 24, note: 'Size from your corrected catalog: 12 OZ 24CT.' },
  // His corrected catalog writes "28 OZ" next to this line (red) at $30.99; no case count written.
  'BODY ARMOUR TROPICCAL PASSION FRUIT': { size: '28 OZ', note: 'Size from your corrected catalog: 28 OZ (case count not written).' },
  // Case count not printed; the owner's price list (A2Z_Mismatch_With_Prices.pdf) gives "RED BULL VARIETY PACK — 8.4 OZ / 24 CT".
  // Count cut to "24" in the catalog; the owner's note "PRICE OF PEPSI, MOUNTAIN DEW, AND Dr PEPPER: 20 OZ 24 - $25.99".
  'DR PEPPER STRAWBERRY CREAM 20 OZ 24': { count: 24, note: 'Case count shown as "24" in the catalog; your price note says 20 OZ 24.' },
  'RED BULL VARIETY PK IVB WP CS 8.4OZ': { count: 24, note: 'Case count from your price list (8.4 oz / 24 ct).' },
};

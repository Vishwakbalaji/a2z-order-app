/**
 * Owner document (2026-11-21): "A2Z_Catalog_Matched_Prices.pdf" — his catalog ⇄ price-sheet matches.
 * Checked row by row against the price sheet (tests/tool-reconcile.test.ts) and against the app:
 *  - 433 priced rows already agree with the app (same price line) → nothing to change;
 *  - the rows below with a line: priced in his document, not yet priced in the app; each price equals
 *    the price-sheet line exactly;
 *  - the rows below with null: NO PRICE in his document → "Price not added" (his instruction);
 *  - not applied (not supported by the price sheet): SAN PELLEGRINO GLASS 11OZ 24CT ($26.99 is the
 *    Maison Perrier 11OZ glass line) and SARATOGA SPARKLING GLASS 12OZ 24CT (priced from the STILL line).
 * Format: [catalog description, price line brand, price line description, case price in his document (cents)]
 */
export const OWNER_DOC_FILE = "A2Z_Catalog_Matched_Prices.pdf";
export const OWNER_DOC_MATCHES: [catalogRaw: string, priceBrand: string | null, priceDesc: string | null, docCents: number | null][] = [
  ["BLOOM ENERGY STRAWBERRY WATERMELON", "BLOOM", "12OZ / 12CT", 2499],
  ["CANADA DRY CAN CRANBERRY 12OZ 24CT", "GINGER ALE / 7UP / A&W", "12OZ / 2-12CT", 1299],
  ["CANADA DRY CAN BLACKBERRY 12OZ 24CT", "GINGER ALE / 7UP / A&W", "12OZ / 2-12CT", 1299],
  ["CORE POWER 26GR STRAWBERRY BANANA 1", "CORE POWER", "26G / 12CT", 3499],
  ["CORE POWER 42GR CHOCOLATE ELITE 14O", "CORE POWER", "42G / 12CT", 4999],
  ["CORE POWER 42GR VANILLA ELITE 14OZ", "CORE POWER", "42G / 12CT", 4999],
  ["FOCO COCO 24CT", "COCONUT WATER", "FOCO 17.6OZ / 24CT", 3995],
  ["MAISON PERRIER SPARKLING LIME 16.9O", "MAISON PERRIER", "16OZ / 24CT (PLASTIC)", 2599],
  ["OKF RED SMOOTHY 12CT", "OKF", "16.9OZ / 12CT", 1599],
  ["OKF SMOOTHY PURPLE 12CT", "OKF", "16.9OZ / 12CT", 1599],
  ["SNAPPLE DIET LEMONADE TEA 12CT", "SNAPPLE", "16OZ / 12CT", 1299],
  ["STARBUCKS FRAPPUCHINE VANILA 9.5OZ", "STARBUCKS", "9.5OZ / 15CT", 2299],
  ["STARBUCKS DOUBLE CHOT CAREMAL 15OZ", "STARBUCKS", "15.7OZ / 12CT", 3599],
  ["VITAMIN WATER ENERGY-TROPICAL CITRU", "VITAMIN WATER", "20OZ / 12CT", 1999],
  ["VITAMIN WATER ESSENTIAL-ORANGE 20OZ", "VITAMIN WATER", "20OZ / 12CT", 1999],
  ["VITAMIN WATER FOCUS-KIWI STRAWBERRY", "VITAMIN WATER", "20OZ / 12CT", 1999],
  ["VITAMIN WATER POWER-DRAGONFRUIT 20O", "VITAMIN WATER", "20OZ / 12CT", 1999],
  ["VITAMIN WATER REFRESH-TROPICAL MANG", "VITAMIN WATER", "20OZ / 12CT", 1999],
  ["VITAMIN WATER XXX-ACAI-BLUEBERRY-PO", "VITAMIN WATER", "20OZ / 12CT", 1999],
  ["VITAMIN WATER SHINE ZERO SUGAR-STRA", "VITAMIN WATER", "20OZ / 12CT", 1999],
  ["FANTA MEXICO 355ML 24CT", null, null, null],
  ["FANTA PINEAPPLE MEXICO 335ML 24CT", null, null, null],
  ["FANTA STRAWBERRY MEXICO 335ML 24CT", null, null, null],
  ["FANTA GRAPE MEXICO 355ML 24CT", null, null, null],
  ["GATORADE FUTURE USE 20OZ 24CT", null, null, null],
  ["MAISON PERRIER GLASS 330ML 24PK", null, null, null],
  ["RED BULL VARIETY PK IVB WP CS 8.4OZ", null, null, null],
];

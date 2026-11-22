/**
 * The owner's supplemental price list "A2Z_Mismatch_With_Prices.pdf" (2026-11-22), one entry per row.
 * Colors read from the PDF itself (text color): red #c8102e = confirmed by the owner, orange #b45309 = closest
 * item on the price sheet (approximate), grey "Not on sheet". Each row lists the exact catalog lines it covers
 * (by original catalog text). Rows with two prices are left for the owner to choose ("select").
 * Prices are copied exactly as printed; nothing is calculated.
 */
import type { PriceOption } from '../types';

export const SUPPLEMENT_FILE = 'A2Z_Mismatch_With_Prices.pdf';

export interface SupplementRow {
  row: string; // product / size as printed in the list
  color: 'red' | 'orange' | 'grey';
  cents: number | null;
  options?: PriceOption[]; // rows printed with two prices or a range
  sheet?: string; // the "Sheet:" reference printed under the price
  products: string[]; // catalog lines (original text) this row applies to
  note?: string; // discrepancy kept for the audit
}

const c = (d: number) => Math.round(d * 100);

export const SUPPLEMENT_ROWS: SupplementRow[] = [
  // ---------------- left column ----------------
  { row: '7UP — 12 OZ / 36 CT', color: 'orange', cents: c(12.99), sheet: 'Sheet: 12 oz / 2-12 ct', products: ['7UP 12OZ 36CT'], note: 'Price sheet case is 24 (2 × 12); catalog case is 36' },
  { row: 'AQUAFINA — 16.9 OZ / 40 CT', color: 'orange', cents: c(6.99), sheet: 'Sheet: 16.9 oz / 32 ct (40 ct removed)', products: ['AQUAFINA 16.9OZ 40CT'], note: 'Price sheet case is 32; catalog case is 40' },
  {
    row: 'ARIZONA CAN — 22 OZ / 24 CT', color: 'orange', cents: c(18.49), sheet: 'Sheet: 20 oz / 24 ct',
    products: [
      'ARIZONA CAN-GREEN TEA 22OZ 24CT', 'ARIZONA CAN-LEMON ICE TEA 22OZ 24PK', 'ARIZONA CAN-MUCHO MANGO 22OZ 24CT', 'ARIZONA CAN FROST CHILLZICLE 22OZ 2',
      'ARIZONA CAN FRUIT PUNCH 22OZ 24CT', 'ARIZONA CAN GRAPEADE 22OZ 24CT', 'ARIZONA CAN KIWI STRAWBERRY 22OZ 24', 'ARIZONA CAN LEMONADE 22OZ 24CT',
      'ARIZONA CAN PEACH TEA 22OZ 24CT', 'ARIZONA CAN RASPBERRY 22OZ 24CT', 'ARIZONA CAN RX ENERGY 22OZ 24CT', 'ARIZONA CAN SWEET TEA 22OZ 24CT',
      'ARIZONA CAN TROPICAL CHILZICLE 22OZ', 'ARIZONA CAN WATERMELON 22OZ 24CT', 'ARIZONA CAN RX WATERMELON 22OZ 24CT', 'ARIZONA CAN ORANGADE 22OZ 24CT',
    ],
    note: 'Price sheet item is 20 oz; catalog cans are 22 oz',
  },
  { row: 'ARIZONA — 16 OZ / 24 CT', color: 'orange', cents: c(18.49), sheet: 'Sheet: 20 oz / 24 ct', products: ['ARIZONA GRREN TEA W GINSENG 16OZ 24', 'ARIZONA HALF N HALF 16FL 24PK'], note: 'Price sheet item is 20 oz; catalog is 16 oz' },
  { row: 'BODY ARMOUR — 28 OZ / 12 CT', color: 'orange', cents: c(30.99), sheet: 'Sheet: 28 oz / 15 ct', products: ['BODY ARMOUR TROPICAL PUNCH 28OZ 12C'], note: 'Price sheet case is 15; catalog case is 12' },
  {
    row: 'BODY ARMOUR TROPICAL PASSION FRUIT — size / count not shown', color: 'orange', cents: null,
    options: [{ cents: c(20.99), label: '16 oz / 12 ct' }, { cents: c(30.99), label: '28 oz / 15 ct' }],
    sheet: 'Sheet: 16 oz/12 ct · 28 oz/15 ct', products: ['BODY ARMOUR TROPICCAL PASSION FRUIT'], note: 'Catalog does not show the size; two prices possible',
  },
  { row: 'BRISK — 12 OZ CAN / 24 CT (2 × 12)', color: 'red', cents: c(14.99), products: ['BRISK LEMON ICE TEA 2/12PK'] },
  { row: 'BRISK — 1 L / 12 CT', color: 'red', cents: c(20.49), products: ['BRISK LEMON 1L 12CT'] },
  { row: 'CANADA DRY GINGER ALE — 1 L / 15 CT', color: 'red', cents: c(24.99), products: ['CANADA DRY GINGER ALE 1L 15CT'] },
  {
    row: 'CANADA DRY GINGER ALE ZERO SUGAR — size / count incomplete', color: 'orange', cents: null,
    options: [{ cents: c(25.99), label: '20 oz / 24 ct' }, { cents: c(12.99), label: '12 oz cans / 2-12 ct' }],
    sheet: 'Sheet: Ginger Ale 20 oz · 12 oz', products: ['CANADA DRY GINGER ALE ZERO SUGAR 2'], note: 'Catalog size is cut off ("…2"); two prices possible',
  },
  {
    row: 'CANADA DRY TONIC WATER ZERO SUGAR — size / count incomplete', color: 'orange', cents: null,
    options: [{ cents: c(24.99), label: '1 L / 15 ct' }, { cents: c(12.99), label: '12 oz cans / 24 ct' }],
    sheet: 'Sheet: Tonic 1 L/15 ct · can 24 ct', products: ['CANADA DRY TONIC WATER ZERO SUGAR 1'], note: 'Catalog size is cut off ("…1"); two prices possible',
  },
  { row: 'CELSIUS VARIETY PACK — 12 OZ / 18 CT', color: 'orange', cents: c(20.49), sheet: 'Sheet: 12 oz / 12 ct', products: ['CELSIUS VRTY PACK 12OZ 18CT'], note: 'Price sheet case is 12; catalog case is 18' },
  { row: 'D&G JAMAICAN SODA / GINGER BEER — 12 OZ / 24 CT', color: 'red', cents: c(29.99), products: ['JAMAICAN CREAM SODA D&G 12OZ 24PK', 'JAMAICAN PINEAPPLE SODA D&G 12OZ 24', 'JAMAICAN KOLA D&G 12OZ 24PK', 'JAMAICAN GINGER BEER D&G 12OZ 24PK'] },
  { row: 'DR PEPPER — 12 OZ / 36 CT', color: 'orange', cents: c(14.99), sheet: 'Sheet: 12 oz / 2-12 ct', products: ['DR PEPPER 12OZ 36CT'], note: 'Price sheet case is 24 (2 × 12); catalog case is 36' },
  { row: 'ESSENTIA WATER — 500 ML / 24 CT', color: 'orange', cents: c(27.99), sheet: 'Sheet: 20 oz / 24 ct', products: ['ESSENTIAL 500ML 24CT'], note: 'Price sheet item is 20 oz; catalog is 500 ml' },
  { row: 'FANTA MEXICO — 355 ML / 24 CT', color: 'orange', cents: c(40.99), sheet: 'Sheet: Coke Mexico 355 ml / 24 ct', products: ['FANTA MEXICO 355ML 24CT', 'FANTA GRAPE MEXICO 355ML 24CT'], note: 'Priced from the Coke Mexico line' },
  { row: 'FANTA MEXICO — 335 ML / 24 CT', color: 'orange', cents: c(40.99), sheet: 'Likely 355 ml – same as above', products: ['FANTA PINEAPPLE MEXICO 335ML 24CT', 'FANTA STRAWBERRY MEXICO 335ML 24CT'], note: 'Catalog says 335 ml (likely 355 ml); priced from the Coke Mexico line' },
  { row: 'FIJI WATER — 330 ML / 24 CT', color: 'orange', cents: c(24.99), sheet: 'Sheet: 0.5 L / 24 ct', products: ['FIJI WATER 330ML 24CT'], note: 'Price sheet item is 0.5 L; catalog is 330 ml' },
  { row: 'GATORADE FROST GLACIER CHERRY — 16 OZ / count not shown', color: 'orange', cents: c(23.99), sheet: 'Sheet: 20 oz / 24 ct', products: ['GATORADE FROST GLACIER CHERRY 16OZ'], note: 'Price sheet item is 20 oz / 24; catalog is 16 oz, count not shown' },
  { row: 'GATORADE FUTURE USE — 20 OZ / 24 CT', color: 'red', cents: c(23.99), products: ['GATORADE FUTURE USE 20OZ 24CT'] },
  { row: 'MAISON PERRIER GLASS — 330 ML / 24 CT', color: 'red', cents: c(26.99), sheet: 'Sheet: 11 oz glass / 24 ct', products: ['MAISON PERRIER GLASS 330ML 24PK'] },
  { row: 'MISTIC JUICE — 15.9 OZ / 12 CT', color: 'red', cents: c(14.99), products: ['MISTIC JUICE TROPICAL CARROT 15.9OZ', 'MISTIC JUICE MANGO CARROT 15.9OZ 12', 'MISTIC JUICE ORANGE CARROT 15.9OZ 1'] },
  { row: 'MISTIC TROPICAL FRUIT PUNCH — size / count incomplete', color: 'grey', cents: null, products: ['MISTIC JUICE TROPICAL FRUIT PUNCH 1'], note: 'Not on sheet' },
  { row: 'MISTIC TROPICAL KIWI STRAWBERRY — size / count not shown', color: 'grey', cents: null, products: ['MISTIC JUICE TROPICAL KIWI STRAWBER'], note: 'Not on sheet' },
  { row: 'MONSTER JAVA VARIETY — 16 OZ / 12 CT', color: 'orange', cents: c(38.5), sheet: 'Sheet: 16 oz / 24 ct', products: ['MONSTER JAVA VRTY 16OZ 12CT'], note: 'Price sheet case is 24; catalog case is 12' },
  // ---------------- right column ----------------
  { row: 'MOUNTAIN DEW — 12 OZ / 36 CT', color: 'orange', cents: c(14.99), sheet: 'Sheet: 12 oz / 2-12 ct', products: ['MOUNTAIN DEW 12OZ 36CT'], note: 'Price sheet case is 24 (2 × 12); catalog case is 36' },
  { row: 'NOS ORIGINAL — 16 OZ / 24 CT', color: 'red', cents: c(38.5), products: ['NOS ORIGINAL 16 FL OZ'], note: 'Catalog does not print the count; your list says 24' },
  { row: 'PEPSI — 12 OZ / 36 CT', color: 'orange', cents: c(14.99), sheet: 'Sheet: 12 oz / 2-12 ct', products: ['PEPSI 12 OZ 36CT'], note: 'Price sheet case is 24 (2 × 12); catalog case is 36' },
  { row: 'PURE LEAF UNSWEETENED TEA — 18.5 OZ / 15 CT', color: 'orange', cents: c(17.99), sheet: 'Sheet: 18.5 oz / 12 ct', products: ['PURE LEAF UNSWEETEN TEA 18.5OZ 15CT'], note: 'Price sheet case is 12; catalog case is 15' },
  {
    row: 'RED BULL AMBER STRAWBERRY APRICOT — size / count not shown', color: 'orange', cents: null,
    options: [{ cents: c(40.99), label: '8.4 oz / 24 ct' }, { cents: c(54.99), label: '12 oz / 24 ct' }],
    sheet: 'Sheet: Red Bull by size', products: ['RED BULL AMBER STRAWBERRY APPRICOT'],
    note: 'Range $40.99–$54.99 by size; resolved by size below (catalog corrections)',
  },
  { row: 'RED BULL VARIETY PACK — 8.4 OZ / 24 CT', color: 'red', cents: c(34.99), products: ['RED BULL VARIETY PK IVB WP CS 8.4OZ'] },
  { row: 'SAN PELLEGRINO GLASS — 750 ML / 15 CT', color: 'orange', cents: c(28.99), sheet: 'Sheet: 750 ml glass / 12 ct', products: ['SAN PELLEGRINO GLASS 750ML 15CT'], note: 'Price sheet case is 12; catalog case is 15' },
  { row: 'SAN PELLEGRINO GLASS — 500 ML / 24 CT', color: 'orange', cents: c(24.99), sheet: 'Sheet: 0.5 L plastic / 24 ct', products: ['SAN PELLEGRINO GLASS 500ML 24CT'], note: 'Price sheet item is plastic; catalog is glass' },
  { row: 'SARATOGA SPARKLING PET — 16 OZ / count incomplete', color: 'orange', cents: c(22.49), sheet: 'Sheet: sparkling 12 oz / 12 ct', products: ['SARATOGA SPARKLING PET WATER 16OZ 2'], note: 'Price sheet item is 12 oz / 12; catalog is 16 oz PET' },
  { row: 'SCHWEEPS — 20 OZ / 24 CT', color: 'orange', cents: c(25.99), sheet: 'Sheet: Ginger Ale/7UP 20 oz / 24 ct', products: ['SCHWEEPS 20OZ 24PK'], note: 'Priced from the Ginger Ale / 7UP / A&W line' },
  { row: 'SCHWEEPS CAN — size not shown / 24 CT (2 × 12)', color: 'orange', cents: c(12.99), sheet: 'Sheet: Ginger Ale/7UP 12 oz / 2-12 ct', products: ['SCHWEEPS Can 2/12'], note: 'Priced from the Ginger Ale / 7UP / A&W line' },
  { row: 'BLACK PLASTIC BAGS — 1/10', color: 'red', cents: c(13.0), sheet: 'Sheet: Small / 1200 bags', products: ['1/10 BLACK PLASTIC BAG'] },
  { row: 'BLACK PLASTIC BAGS — 1/8', color: 'red', cents: c(13.0), sheet: 'Sheet: Medium / 900 bags', products: ['1/8 BLACK PLASTIC BAG'] },
  { row: 'BLACK PLASTIC BAGS — 1/6', color: 'red', cents: c(13.0), sheet: 'Sheet: Big / 500 bags', products: ['1/6 BLACK PLASTIC BAG'] },
  { row: 'BLACK DOUBLE BOTTLE LIQUOR BAG — size / count not shown', color: 'orange', cents: c(17.5), sheet: 'Sheet: Liquor bags / 750 ct', products: ['BLACK DOUBLE BOTTLE LIQUOR BAG'] },
  { row: 'SMART WATER — 500 ML / 24 CT', color: 'orange', cents: c(30.99), sheet: 'Sheet: 20 oz / 24 ct', products: ['SMART WATER 500ML 24PK'], note: 'Price sheet item is 20 oz; catalog is 500 ml' },
  { row: 'SMART WATER ALKALINE — 500 ML / 24 CT', color: 'red', cents: c(20.99), products: ['SMART WATER ALKALINE 500ML 24CT'] },
  { row: 'SPRITE MEXICO — 330 ML / 24 CT', color: 'orange', cents: c(40.99), sheet: 'Sheet: Coke Mexico 355 ml / 24 ct', products: ['SPRITE MEXICO 330ML 24CT'], note: 'Priced from the Coke Mexico line (355 ml)' },
  { row: 'SUNKIST — 12 OZ / 36 CT', color: 'orange', cents: c(12.99), sheet: 'Sheet: 12 oz / 2-12 ct', products: ['SUNKIST 12OZ 36CT'], note: 'Price sheet case is 24 (2 × 12); catalog case is 36' },
  { row: 'SUNKIST — 2 L / 8 CT', color: 'red', cents: c(13.99), products: ['SUNKIST ORANGE 2L 8CT'] },
  { row: 'TROPICANA CRANBERRY — 15 OZ / 15 CT', color: 'red', cents: c(23.99), products: ['TROPICANA CRANBERRY 15OZ 15CT'] },
  { row: 'TROPICANA CRANBERRY JUICE — 32 OZ / 12 CT', color: 'red', cents: c(23.99), products: ['TROPICANA CRANBERRY JUICE 32OZ 1/12'] },
  {
    row: 'TROPICANA PREMIUM — 11 OZ / 12 CT', color: 'red', cents: c(23.99),
    products: ['TROPICANA PREMIUM APPLE 12OZ 1/12 C', 'TROPICANA PREMIUM CRANBERRY 12OZ 1/', 'TROPICANA PREMIUM OJ CALCIUM 12OZ 1'],
    note: 'Your list says 11 oz; the catalog prints 12 oz for these Tropicana Premium items',
  },
  { row: 'TROPICANA PREMIUM LIVELY LEMONADE — size / count not shown', color: 'red', cents: c(23.99), products: ['TROPICANA PREMIUM LIVELY LEMONADE 1'] },
  { row: 'TROPICANA PREMIUM STRAWBERRY LEMONADE — size / count not shown', color: 'red', cents: c(23.99), products: ['TROPICANA PREMIUM STRAWBERRY LEMONA'] },
];

/**
 * Rows whose price depends on a size the catalog did not print, resolved from verified size information
 * (src/data/catalogCorrections.ts). The status stays as printed (orange = approximate).
 */
export const SUPPLEMENT_RESOLVED: Record<string, { cents: number; why: string }> = {
  'RED BULL AMBER STRAWBERRY APPRICOT': {
    cents: c(40.99),
    why: 'Size resolved to 8.4 oz / 24 ct (Red Bull U.S. sells Amber in 8.4 and 12 oz; the 12 oz is a separate catalog product) → the 8 oz / 24 ct price',
  },
};

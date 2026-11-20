export type MatchStatus = 'matched' | 'review' | 'unmatched';
export type Origin = 'pricesheet' | 'catalog' | 'manual';

/** One priced line from a distributor price sheet (price is per CASE, in cents). */
export interface PriceItem {
  id: string;
  key: string; // normalized brand|desc — used to recognise the same line in updated sheets
  section: string;
  brand: string;
  desc: string;
  sku: string;
  priceCents: number;
  prevPriceCents: number | null; // price before the latest update (if it changed)
  raw: string; // original extracted text
  sourceFile: string;
  importedAt: number;
  missingFromLatest: boolean; // not present in the most recently imported sheet
  order: number;
}

/** A purchasable product variation (one size / case configuration). */
export interface Product {
  id: string;
  origin: Origin;
  department: string;
  category: string;
  brand: string;
  name: string;
  variation: string; // size / case configuration as printed, e.g. "20OZ / 24CT"
  unitsPerCase: number | null;
  sku: string;
  catalogName: string; // original catalog text (catalog products)
  priceItemId: string | null; // linked price sheet line
  priceOverrideCents: number | null; // manually entered price (wins over the price sheet)
  matchStatus: MatchStatus;
  matchMethod: string; // 'pricesheet' | 'sku' | 'auto' | 'manual' | ''
  matchScore: number;
  suggestedPriceItemId: string | null; // for 'review'
  active: boolean; // false = discontinued / hidden
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Store {
  id: string;
  name: string;
  address: string;
  phone: string;
  manager: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DraftLine {
  productId: string;
  qty: number; // cases
  note?: string;
}
export interface Draft {
  storeId: string;
  lines: DraftLine[];
  updatedAt: number;
}

export interface OrderLine {
  productId: string;
  name: string; // full product name at the time of the order
  unitsPerCase: number | null;
  priceCents: number | null; // case price at the time of the order (null = not available)
  qty: number;
  note: string;
  lineTotalCents: number | null;
}
export interface Totals {
  products: number;
  cases: number;
  valueCents: number; // sum of priced lines only
  unpricedLines: number;
  unpricedCases: number;
}
export interface CompanyInfo {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
}
/** Completed order — an immutable snapshot. */
export interface Order {
  id: string;
  orderNo: string;
  storeId: string;
  store: { name: string; address: string; phone: string; manager: string };
  rep: { name: string; phone: string };
  company: CompanyInfo;
  lines: OrderLine[];
  totals: Totals;
  createdAt: number;
}

export interface Settings extends CompanyInfo {
  id: 'app';
  repName: string;
  repPhone: string;
  logoDataUrl: string | null; // null = bundled distributor logo
  selectedStoreId: string | null;
  orderSeq: number;
  seededAt: number;
}

/** A confirmed product → price sheet mapping, remembered across re-imports. */
export interface Mapping {
  key: string; // 'SKU:xxx' or 'N:normalized product name'
  priceItemKey: string | null; // null = user chose "leave unmatched"
  updatedAt: number;
}

export interface ImportLog {
  id: string;
  kind: 'pricesheet' | 'catalog' | 'restore' | 'seed';
  fileName: string;
  at: number;
  summary: string;
  rawLines: string[]; // original extracted text, preserved for comparison
}

export interface Snapshot {
  id: string;
  at: number;
  reason: string;
  json: string;
}

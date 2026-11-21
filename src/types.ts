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
  suggestedPriceItemId: string | null; // for 'review' (for 'unmatched': the closest line, information only)
  /** Why the match was verified: 'exact' | 'naming' | 'flavors-listed' | 'brand-level' | 'count-cut-off' | 'sku'. */
  matchBasis?: string | null;
  /** Material differences / uncertainties that keep it from being verified (shown in Review). */
  matchFlags?: string[];
  /** Non-blocking observations (e.g. "0.5L = 500ML"). */
  matchNotes?: string[];
  active: boolean; // false = discontinued / hidden
  missingFromCatalog?: boolean; // was in an earlier catalog but not in the latest one (kept, flagged)
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
  archivedAt?: number | null; // when it was archived (weekly reports use this)
  createdAt: number; // "Date Added" — recorded automatically
  updatedAt: number;
  /** Marked "New Store" when it was created (acquired). Stores created before this feature are not new. */
  isNew?: boolean;
  /** Order id of the first finalized order that carried the "NEW STORE — FIRST ORDER" label. */
  firstOrderId?: string | null;
  firstOrderAt?: number | null;
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
  createdAt: number; // finalized date/time — decides the reporting week
  /** true only on a new store's first finalized order: its PDFs show "NEW STORE — FIRST ORDER". */
  newStoreFirstOrder?: boolean;
}

/**
 * A correction recorded AFTER an order was finalized. The order snapshot itself never changes;
 * reports apply adjustments when they are generated, and finalized reports are never rewritten.
 */
export interface OrderAdjustment {
  id: string;
  orderId: string;
  kind: 'void' | 'price'; // void = cancelled order; price = a missing case price resolved
  lineIndex?: number;
  priceCents?: number;
  reason: string;
  at: number;
}

export interface ReportStoreRow {
  storeId: string;
  name: string;
  location: string;
}
export interface WeeklyReportData {
  newStores: (ReportStoreRow & { addedAt: number })[];
  storesWithOrders: (ReportStoreRow & { orders: number; cases: number; valueCents: number; pendingOrders: number })[];
  orders: { orderId: string; orderNo: string; storeId: string; storeName: string; at: number; cases: number; valueCents: number | null }[];
  flaggedOrders: { orderId: string; orderNo: string; storeName: string; unpricedLines: number }[];
  ordersCount: number;
  distinctStores: number;
  totalCases: number;
  salesCents: number; // confirmed sales: eligible orders whose every line has a price
  activeStores: number;
  nonOrdering: (ReportStoreRow & { lastOrderAt: number | null })[] | null; // null = first week (not applicable)
  commissionRateBps: number; // 100 = 1%
  commissionCents: number;
}
export interface WeeklyReport {
  id: string; // unique: "WR-2026-11-21" (original) or "WR-2026-11-21-R1" (revision)
  periodKey: string; // week start (Saturday) "YYYY-MM-DD", America/New_York
  revision: number; // 0 = original
  weekNumber: number;
  start: string; // Saturday YYYY-MM-DD
  end: string; // Friday YYYY-MM-DD
  startUtc: number;
  endUtc: number; // exclusive (next Saturday 00:00 New York)
  status: 'final' | 'superseded' | 'provisional'; // provisional = week still open, never saved
  supersededBy?: string | null;
  supersedes?: string | null;
  revisionReason?: string;
  createdAt: number;
  generatedBy: 'auto' | 'manual';
  rep: { name: string; phone: string };
  company: CompanyInfo;
  data: WeeklyReportData;
}

export interface Settings extends CompanyInfo {
  id: 'app';
  repName: string;
  repPhone: string;
  logoDataUrl: string | null; // null = bundled distributor logo
  selectedStoreId: string | null;
  orderSeq: number;
  seededAt: number;
  bundledVersion?: number; // highest bundled dataset (src/data/bundled.ts) applied on this phone
  dataNotice?: { title: string; text: string; at: number; review: number } | null; // shown once after a bundled update
}

/** A confirmed product → price sheet mapping, remembered across re-imports. */
export interface Mapping {
  key: string; // 'SKU:xxx' or 'N:normalized product name'
  priceItemKey: string | null; // null = user chose "leave unmatched"
  updatedAt: number;
  /** 'rule90' = accepted by the owner's 90%-or-higher rule (bundled update v4); absent = decided by hand. */
  source?: string;
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

/**
 * Single in-memory app state backed by IndexedDB.
 * UI reads via useApp(selector); every change is written to IndexedDB immediately
 * (draft writes are queued and coalesced so rapid +/- taps can never be lost or reordered).
 */
import { useSyncExternalStore } from 'react';
import { db, uid } from '../db/db';
import * as importer from '../db/importer';
import { exportBackup, restoreBackup, restoreSnapshot, type BackupFile } from '../db/backup';
import type { Draft, DraftLine, Order, OrderAdjustment, PriceItem, Product, ProductImageOverride, Settings, Store } from '../types';
import { ensureWeeklyReports } from '../db/reports';
import { buildIndex, type IndexEntry } from '../lib/search';
import { computeTotals, displayName, effectivePrice, supersededPriceItemIds } from '../lib/products';

export interface AppState {
  ready: boolean;
  error: string | null;
  products: Product[];
  productById: Map<string, Product>;
  priceItems: PriceItem[];
  priceItemById: Map<string, PriceItem>;
  stores: Store[];
  drafts: Map<string, DraftLine[]>; // storeId -> lines (qty > 0), in the order they were added
  settings: Settings;
  index: Map<string, IndexEntry>;
  browseIds: string[]; // active, visible products in catalog order
  departments: string[];
  reviewCount: number;
  reportsVersion: number;
  imageOverrides: Map<string, ProductImageOverride>; // the owner's picture decisions, by product id
}

const emptySettings: Settings = {
  id: 'app',
  companyName: '',
  companyAddress: '',
  companyPhone: '',
  repName: 'Vishwak',
  repPhone: '',
  logoDataUrl: null,
  selectedStoreId: null,
  orderSeq: 0,
  seededAt: 0,
};

let state: AppState = {
  ready: false,
  error: null,
  products: [],
  productById: new Map(),
  priceItems: [],
  priceItemById: new Map(),
  stores: [],
  drafts: new Map(),
  settings: emptySettings,
  index: new Map(),
  browseIds: [],
  departments: [],
  reviewCount: 0,
  reportsVersion: 0,
  imageOverrides: new Map(),
};

const listeners = new Set<() => void>();
function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export function getState() {
  return state;
}
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useApp<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
}

function deriveCatalog(products: Product[], priceItems: PriceItem[]): Partial<AppState> {
  const priceItemById = new Map(priceItems.map((i) => [i.id, i]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const sup = supersededPriceItemIds(products);
  const visible = products.filter((p) => p.active && !(p.origin === 'pricesheet' && p.priceItemId && sup.has(p.priceItemId)));
  const deptOrder = new Map<string, number>();
  [...products].sort((a, b) => a.order - b.order).forEach((p) => {
    const d = p.department || 'Other';
    if (!deptOrder.has(d)) deptOrder.set(d, deptOrder.size);
  });
  // within a department: grouped by brand (A–Z), catalog products first, then catalog / sheet order
  const groupKey = (p: Product) => (p.category || p.brand || '').toUpperCase().split(/[\s/]+/)[0] || '~';
  const keys = new Map(visible.map((p) => [p.id, groupKey(p)]));
  visible.sort(
    (a, b) =>
      deptOrder.get(a.department || 'Other')! - deptOrder.get(b.department || 'Other')! ||
      keys.get(a.id)!.localeCompare(keys.get(b.id)!) ||
      Number(a.origin === 'pricesheet') - Number(b.origin === 'pricesheet') ||
      a.order - b.order,
  );
  const departments = [...new Set(visible.map((p) => p.department || 'Other'))];
  return {
    products,
    productById,
    priceItems,
    priceItemById,
    index: buildIndex(visible),
    browseIds: visible.map((p) => p.id),
    departments,
    reviewCount: products.filter((p) => p.active && p.origin !== 'pricesheet' && p.matchStatus === 'review').length,
  };
}

export async function init() {
  try {
    await importer.syncBundledData();
    await reload();
    await refreshReports(); // finalize any reporting week that ended while the app was closed
    // ask the browser not to evict our data under storage pressure
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* not supported */
    }
  } catch (e) {
    set({ error: (e as Error).message || String(e), ready: true });
  }
}

/** After cloud data arrives: reload everything and refresh report screens. */
export async function reloadFromCloud() {
  await reload();
  set({ reportsVersion: state.reportsVersion + 1 });
}

export async function reload() {
  const [products, priceItems, stores, drafts, settings, images] = await Promise.all([
    db.products.toArray(),
    db.priceItems.toArray(),
    db.stores.toArray(),
    db.drafts.toArray(),
    db.settings.get('app'),
    db.productImages.toArray(),
  ]);
  stores.sort((a, b) => a.name.localeCompare(b.name));
  // replay cart changes that did not reach IndexedDB before the page was closed
  const storeIds = new Set(stores.map((s) => s.id));
  for (const w of walEntries()) {
    const cur = drafts.find((d) => d.storeId === w.storeId);
    if (storeIds.has(w.storeId) && (!cur || w.updatedAt > cur.updatedAt)) {
      await db.drafts.put(w);
      if (cur) Object.assign(cur, w);
      else drafts.push(w);
    }
    walClear(w);
  }
  lastStamp = Math.max(lastStamp, ...drafts.map((d) => d.updatedAt || 0));
  const draftMap = new Map<string, DraftLine[]>();
  for (const d of drafts) draftMap.set(d.storeId, d.lines.filter((l) => l.qty > 0));
  set({ ...deriveCatalog(products, priceItems), stores, drafts: draftMap, settings: settings || emptySettings, imageOverrides: new Map(images.map((i) => [i.id, i])), ready: true, error: null });
}

/* ------------------------- prices & totals ------------------------- */

export function priceOf(productId: string, s: AppState = state): number | null {
  const p = s.productById.get(productId);
  return p ? effectivePrice(p, s.priceItemById) : null;
}
export function cartTotals(lines: DraftLine[], s: AppState = state) {
  return computeTotals(lines, (id) => priceOf(id, s));
}

/* ------------------------- drafts (carts) ------------------------- */

/*
 * Cart writes: IndexedDB is asynchronous, so a tap followed immediately by closing
 * Chrome could lose the last change. Every change is therefore ALSO written
 * synchronously to a small localStorage journal ("write-ahead log"), which is
 * replayed on the next start if it is newer than what IndexedDB holds.
 */
const WAL_PREFIX = 'a2z-wal-draft:';
let lastStamp = 0;
function stamp() {
  lastStamp = Math.max(Date.now(), lastStamp + 1); // strictly increasing
  return lastStamp;
}
function walWrite(d: Draft) {
  try {
    localStorage.setItem(WAL_PREFIX + d.storeId, JSON.stringify(d));
  } catch {
    /* storage unavailable: IndexedDB write still happens */
  }
}
function walClear(d: Draft) {
  try {
    const raw = localStorage.getItem(WAL_PREFIX + d.storeId);
    if (raw && (JSON.parse(raw) as Draft).updatedAt <= d.updatedAt) localStorage.removeItem(WAL_PREFIX + d.storeId);
  } catch {
    /* ignore */
  }
}
function walEntries(): Draft[] {
  const out: Draft[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(WAL_PREFIX)) continue;
      try {
        const d = JSON.parse(localStorage.getItem(k) || '') as Draft;
        if (d && typeof d.storeId === 'string' && Array.isArray(d.lines) && typeof d.updatedAt === 'number') out.push(d);
      } catch {
        /* corrupt entry */
      }
    }
  } catch {
    /* no localStorage */
  }
  return out;
}
function walClearAll() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(WAL_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

const pending = new Map<string, Draft>();
let flushing: Promise<void> | null = null;
function persistDraft(storeId: string) {
  const d: Draft = { storeId, lines: state.drafts.get(storeId) || [], updatedAt: stamp() };
  walWrite(d);
  pending.set(storeId, d);
  if (!flushing) flushing = flush();
}
async function flush() {
  try {
    while (pending.size) {
      const batch = [...pending.values()];
      pending.clear();
      await db.drafts.bulkPut(batch);
      batch.forEach(walClear);
    }
  } catch (e) {
    set({ error: 'Could not save the cart: ' + (e as Error).message });
  } finally {
    flushing = null;
  }
}
/** Resolves when all queued cart writes are stored (used by tests and before navigation-sensitive actions). */
export async function flushDrafts() {
  while (flushing) await flushing;
}

export function currentLines(s: AppState = state): DraftLine[] {
  const id = s.settings.selectedStoreId;
  return (id && s.drafts.get(id)) || [];
}

/** Set the case quantity for a product in the selected store's draft. Returns false if no store is selected. */
export function setQty(productId: string, qty: number, storeId = state.settings.selectedStoreId): boolean {
  if (!storeId) return false;
  const q = Math.max(0, Math.min(9999, Math.floor(Number.isFinite(qty) ? qty : 0)));
  const lines = state.drafts.get(storeId) || [];
  const i = lines.findIndex((l) => l.productId === productId);
  let next: DraftLine[];
  if (q === 0) next = i < 0 ? lines : lines.filter((_, k) => k !== i);
  else if (i < 0) next = [...lines, { productId, qty: q }];
  else next = lines.map((l, k) => (k === i ? { ...l, qty: q } : l));
  if (next === lines) return true;
  const drafts = new Map(state.drafts);
  drafts.set(storeId, next);
  set({ drafts });
  persistDraft(storeId);
  return true;
}
export function changeQty(productId: string, delta: number): boolean {
  const storeId = state.settings.selectedStoreId;
  if (!storeId) return false;
  const cur = (state.drafts.get(storeId) || []).find((l) => l.productId === productId)?.qty || 0;
  return setQty(productId, cur + delta, storeId);
}
export function setNote(productId: string, note: string) {
  const storeId = state.settings.selectedStoreId;
  if (!storeId) return;
  const lines = state.drafts.get(storeId) || [];
  const drafts = new Map(state.drafts);
  drafts.set(storeId, lines.map((l) => (l.productId === productId ? { ...l, note: note.slice(0, 200) } : l)));
  set({ drafts });
  persistDraft(storeId);
}
export function clearDraft(storeId: string) {
  const drafts = new Map(state.drafts);
  drafts.set(storeId, []);
  set({ drafts });
  persistDraft(storeId);
}

/* ------------------------- stores ------------------------- */

export async function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch, id: 'app' as const };
  set({ settings });
  await db.settings.put(settings);
}
export async function selectStore(id: string | null) {
  await updateSettings({ selectedStoreId: id });
}
/**
 * Create or update a store. "New Store" can only be SET when the store is created; editing can
 * only remove the mark, and only while its first order has not been finalized yet.
 */
export async function saveStore(input: Partial<Store> & { name: string; address: string }): Promise<Store> {
  const now = Date.now();
  const old = input.id ? state.stores.find((s) => s.id === input.id) : undefined;
  const archived = input.archived ?? old?.archived ?? false;
  const isNew = old ? !!old.isNew && !(input.isNew === false && !old.firstOrderId) : !!input.isNew;
  const store: Store = {
    id: old?.id || uid('s_'),
    name: input.name.trim(),
    address: input.address.trim(),
    phone: (input.phone || '').trim(),
    manager: (input.manager || '').trim(),
    archived,
    archivedAt: archived ? (old?.archived ? old.archivedAt ?? old.updatedAt : now) : null,
    createdAt: old?.createdAt || now,
    updatedAt: now,
    isNew,
    firstOrderId: old?.firstOrderId ?? null,
    firstOrderAt: old?.firstOrderAt ?? null,
  };
  await db.stores.put(store);
  const stores = [...state.stores.filter((s) => s.id !== store.id), store].sort((a, b) => a.name.localeCompare(b.name));
  set({ stores });
  return store;
}
export async function archiveStore(id: string, archived: boolean) {
  const s = state.stores.find((x) => x.id === id);
  if (!s) return;
  await saveStore({ ...s, archived });
  if (archived && state.settings.selectedStoreId === id) await selectStore(null);
}
/** Deletes the store and its draft cart. Completed orders are kept (they contain a copy of the store details). */
export async function deleteStore(id: string) {
  await db.transaction('rw', db.stores, db.drafts, async () => {
    await db.stores.delete(id);
    await db.drafts.delete(id);
  });
  const drafts = new Map(state.drafts);
  drafts.delete(id);
  set({ stores: state.stores.filter((s) => s.id !== id), drafts });
  if (state.settings.selectedStoreId === id) await selectStore(null);
}

/* ------------------------- orders ------------------------- */

export async function finalizeOrder(storeId: string): Promise<Order> {
  await flushDrafts();
  const store = state.stores.find((s) => s.id === storeId);
  if (!store) throw new Error('Store not found');
  const lines = (state.drafts.get(storeId) || []).filter((l) => l.qty > 0);
  if (!lines.length) throw new Error('The cart is empty');
  const seq = state.settings.orderSeq + 1;
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const order: Order = {
    id: uid('o_'),
    orderNo: `${ymd}-${String(seq).padStart(4, '0')}`,
    storeId,
    store: { name: store.name, address: store.address, phone: store.phone, manager: store.manager },
    rep: { name: state.settings.repName, phone: state.settings.repPhone },
    company: { companyName: state.settings.companyName, companyAddress: state.settings.companyAddress, companyPhone: state.settings.companyPhone },
    lines: lines.map((l) => {
      const p = state.productById.get(l.productId);
      const price = priceOf(l.productId);
      return {
        productId: l.productId,
        name: p ? displayName(p) : '(deleted product)',
        unitsPerCase: p?.unitsPerCase ?? null,
        priceCents: price,
        qty: l.qty,
        note: l.note || '',
        lineTotalCents: price == null ? null : price * l.qty,
      };
    }),
    totals: cartTotals(lines),
    createdAt: now.getTime(),
  };
  let updatedStore: Store | null = null;
  await db.transaction('rw', db.orders, db.drafts, db.settings, db.stores, async () => {
    // "NEW STORE — FIRST ORDER": decided from the database inside the same transaction, so it can
    // be used exactly once per store, and is recorded in the order snapshot for re-downloads.
    const fresh = await db.stores.get(storeId);
    if (fresh?.isNew && !fresh.firstOrderId) {
      order.newStoreFirstOrder = true;
      updatedStore = { ...fresh, firstOrderId: order.id, firstOrderAt: order.createdAt };
      await db.stores.put(updatedStore);
    }
    await db.orders.add(order);
    await db.drafts.put({ storeId, lines: [], updatedAt: stamp() });
    await db.settings.put({ ...state.settings, orderSeq: seq });
  });
  const drafts = new Map(state.drafts);
  drafts.set(storeId, []);
  const us = updatedStore as Store | null;
  set({ drafts, settings: { ...state.settings, orderSeq: seq }, ...(us ? { stores: state.stores.map((s) => (s.id === us.id ? us : s)) } : {}) });
  void refreshReports();
  return order;
}

/** True while a store marked "New Store" has not had its first order finalized (drafts/previews never use it up). */
export function isFirstOrderPending(storeId: string | null | undefined, s: AppState = state): boolean {
  const st = storeId ? s.stores.find((x) => x.id === storeId) : undefined;
  return !!(st?.isNew && !st.firstOrderId);
}

/* ------------------------- order adjustments (after finalizing) ------------------------- */

export async function listAdjustments(orderId?: string): Promise<OrderAdjustment[]> {
  const all = orderId ? await db.adjustments.where('orderId').equals(orderId).toArray() : await db.adjustments.toArray();
  return all.sort((a, b) => a.at - b.at);
}
/** Cancels a finalized order for reporting purposes. The order record itself is not changed. */
export async function voidOrder(orderId: string, reason: string) {
  if (!reason.trim()) throw new Error('Please give a reason.');
  const existing = await listAdjustments(orderId);
  if (existing.some((a) => a.kind === 'void')) throw new Error('This order is already voided.');
  await db.adjustments.add({ id: uid('adj_'), orderId, kind: 'void', reason: reason.trim(), at: Date.now() });
  void refreshReports();
}
/** Records the case price for a line that had no price when the order was finalized. */
export async function resolveOrderPrice(orderId: string, lineIndex: number, priceCents: number, reason = 'Missing price resolved') {
  const o = await db.orders.get(orderId);
  if (!o || !o.lines[lineIndex]) throw new Error('Order line not found');
  if (o.lines[lineIndex].priceCents != null) throw new Error('This line already has a price.');
  await db.adjustments.add({ id: uid('adj_'), orderId, kind: 'price', lineIndex, priceCents, reason, at: Date.now() });
  void refreshReports();
}

/* ------------------------- weekly reports ------------------------- */

/** Bumped whenever orders, stores or reports change, so the reports screen can refresh. */
let beforeReports: (() => Promise<void>) | null = null;
/** Cloud sync registers itself here so weekly reports include other phones' orders. */
export function setBeforeReports(fn: (() => Promise<void>) | null) {
  beforeReports = fn;
}
export async function refreshReports() {
  try {
    if (beforeReports) await beforeReports();
    await ensureWeeklyReports();
  } catch (e) {
    console.error(e);
  }
  set({ reportsVersion: state.reportsVersion + 1 });
}
export async function listOrders(): Promise<Order[]> {
  return db.orders.orderBy('createdAt').reverse().toArray();
}
export async function getOrder(id: string) {
  return db.orders.get(id);
}
/** Copy a completed order into the store's draft as a NEW draft (the order itself never changes). */
export async function copyOrderToDraft(order: Order): Promise<{ skipped: string[] }> {
  const storeId = order.storeId;
  if (!state.stores.some((s) => s.id === storeId)) throw new Error('That store no longer exists. Re-create it first.');
  const skipped: string[] = [];
  const lines: DraftLine[] = [];
  for (const l of order.lines) {
    const p = state.productById.get(l.productId);
    if (!p || !p.active) {
      skipped.push(l.name);
      continue;
    }
    lines.push({ productId: l.productId, qty: l.qty, ...(l.note ? { note: l.note } : {}) });
  }
  const drafts = new Map(state.drafts);
  drafts.set(storeId, lines);
  set({ drafts });
  persistDraft(storeId);
  await flushDrafts();
  await selectStore(storeId);
  return { skipped };
}

/* ------------------------- catalog admin ------------------------- */

/* ------------------------- product pictures ------------------------- */

/** The owner's picture decision for one product: approve the shipped picture, reject it, or use his own photo. */
export async function setProductImage(p: Product, status: ProductImageOverride['status'], dataUrl: string | null = null) {
  const o: ProductImageOverride = { id: p.id, status, dataUrl: status === 'manual' ? dataUrl : null, catalogName: p.catalogName || displayName(p), updatedAt: Date.now() };
  await db.productImages.put(o);
  set({ imageOverrides: new Map(state.imageOverrides).set(p.id, o) });
}
/** Undo the owner's decision: back to the picture shipped with the app (if any). */
export async function clearProductImage(productId: string) {
  await db.productImages.delete(productId);
  const m = new Map(state.imageOverrides);
  m.delete(productId);
  set({ imageOverrides: m });
}

export async function saveProduct(p: Product) {
  await db.products.put({ ...p, updatedAt: Date.now() });
  await reload();
}
export async function addManualProduct(input: Omit<Product, 'id' | 'origin' | 'createdAt' | 'updatedAt' | 'order' | 'matchStatus' | 'matchMethod' | 'matchScore' | 'suggestedPriceItemId'>) {
  const now = Date.now();
  const p: Product = {
    ...input,
    id: uid('p_'),
    origin: 'manual',
    order: state.products.reduce((m, x) => Math.max(m, x.order), 0) + 10,
    matchStatus: input.priceItemId ? 'matched' : 'unmatched',
    matchMethod: input.priceItemId ? 'manual' : '',
    matchScore: input.priceItemId ? 1 : 0,
    suggestedPriceItemId: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.products.add(p);
  if (input.priceItemId) await importer.confirmMatch(p.id, input.priceItemId);
  await reload();
  return p;
}
export async function setPriceItemPrice(id: string, cents: number) {
  const it = await db.priceItems.get(id);
  if (!it || it.priceCents === cents) return;
  await db.priceItems.put({ ...it, prevPriceCents: it.priceCents, priceCents: cents });
  await reload();
}
export async function confirmMatch(productId: string, priceItemId: string) {
  await importer.confirmMatch(productId, priceItemId);
  await reload();
}
export async function leaveUnmatched(productId: string) {
  await importer.leaveUnmatched(productId);
  await reload();
}
export async function applyPriceSheet(rows: importer.PriceRowInput[], fileName: string) {
  const r = await importer.applyPriceSheet(rows, fileName);
  await reload();
  return r;
}
export async function applyCatalog(rows: importer.CatalogRowInput[], fileName: string, opts: { complete?: boolean } = {}) {
  const r = await importer.applyCatalog(rows, fileName, opts);
  await reload();
  return r;
}

/* ------------------------- backup ------------------------- */

export async function makeBackup(): Promise<BackupFile> {
  await flushDrafts();
  return exportBackup();
}
export async function restoreFromBackup(data: BackupFile) {
  await flushDrafts();
  walClearAll();
  await restoreBackup(data);
  await reload();
  await refreshReports();
}
export async function restoreFromSnapshot(id: string) {
  await flushDrafts();
  walClearAll();
  await restoreSnapshot(id);
  await reload();
  await refreshReports();
}

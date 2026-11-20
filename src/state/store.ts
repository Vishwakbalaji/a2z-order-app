/**
 * Single in-memory app state backed by IndexedDB.
 * UI reads via useApp(selector); every change is written to IndexedDB immediately
 * (draft writes are queued and coalesced so rapid +/- taps can never be lost or reordered).
 */
import { useSyncExternalStore } from 'react';
import { db, uid } from '../db/db';
import * as importer from '../db/importer';
import { exportBackup, restoreBackup, restoreSnapshot, type BackupFile } from '../db/backup';
import type { Draft, DraftLine, Order, PriceItem, Product, Settings, Store } from '../types';
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
  visible.sort((a, b) => (deptOrder.get(a.department || 'Other')! - deptOrder.get(b.department || 'Other')!) || a.order - b.order);
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
    await importer.seedIfEmpty();
    await reload();
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

export async function reload() {
  const [products, priceItems, stores, drafts, settings] = await Promise.all([
    db.products.toArray(),
    db.priceItems.toArray(),
    db.stores.toArray(),
    db.drafts.toArray(),
    db.settings.get('app'),
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
  set({ ...deriveCatalog(products, priceItems), stores, drafts: draftMap, settings: settings || emptySettings, ready: true, error: null });
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
export async function saveStore(input: Partial<Store> & { name: string; address: string }): Promise<Store> {
  const now = Date.now();
  const old = input.id ? state.stores.find((s) => s.id === input.id) : undefined;
  const store: Store = {
    id: old?.id || uid('s_'),
    name: input.name.trim(),
    address: input.address.trim(),
    phone: (input.phone || '').trim(),
    manager: (input.manager || '').trim(),
    archived: input.archived ?? old?.archived ?? false,
    createdAt: old?.createdAt || now,
    updatedAt: now,
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
  await db.transaction('rw', db.orders, db.drafts, db.settings, async () => {
    await db.orders.add(order);
    await db.drafts.put({ storeId, lines: [], updatedAt: stamp() });
    await db.settings.put({ ...state.settings, orderSeq: seq });
  });
  const drafts = new Map(state.drafts);
  drafts.set(storeId, []);
  set({ drafts, settings: { ...state.settings, orderSeq: seq } });
  return order;
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
export async function applyCatalog(rows: importer.CatalogRowInput[], fileName: string) {
  const r = await importer.applyCatalog(rows, fileName);
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
}
export async function restoreFromSnapshot(id: string) {
  await flushDrafts();
  walClearAll();
  await restoreSnapshot(id);
  await reload();
}

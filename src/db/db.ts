import Dexie, { type DBCore, type Middleware, type Table } from 'dexie';
import type { Draft, ImportLog, Mapping, Order, OrderAdjustment, PriceItem, Product, Settings, Snapshot, Store, WeeklyReport } from '../types';
import { SYNCED_TABLES } from '../sync/protocol';

/** A change waiting to be uploaded to the cloud (one entry per record; newer changes overwrite). */
export interface OutboxEntry {
  k: string; // `${tbl}\u0001${id}`
  tbl: string;
  id: string;
  at: number;
}
export interface SyncMetaRow {
  k: string;
  v: unknown;
}

/** Writes made while applying cloud data are tagged so they are not sent back up. */
export const REMOTE_TAG = '__a2zRemote';
const SYNCED = new Set<string>(SYNCED_TABLES);
let onLocalChange: (() => void) | null = null;
export function setLocalChangeListener(fn: (() => void) | null) {
  onLocalChange = fn;
}

/**
 * Dexie middleware: every write to a synced table also records an outbox entry IN THE SAME
 * TRANSACTION, so a change can never be saved locally but forgotten for upload.
 */
function outboxMiddleware(): Middleware<DBCore> {
  return {
    stack: 'dbcore',
    name: 'syncOutbox',
    create(down) {
      return {
        ...down,
        transaction(stores, mode, options) {
          const scope = mode === 'readwrite' && stores.some((n) => SYNCED.has(n)) && !stores.includes('syncOutbox') ? [...stores, 'syncOutbox'] : stores;
          return down.transaction(scope, mode, options);
        },
        table(name) {
          const t = down.table(name);
          if (!SYNCED.has(name)) return t;
          return {
            ...t,
            async mutate(req) {
              const res = await t.mutate(req);
              if ((req.trans as unknown as Record<string, unknown>)[REMOTE_TAG]) return res;
              let keys: unknown[] = [];
              if (req.type === 'add' || req.type === 'put') keys = req.keys ?? req.values.map((v) => t.schema.primaryKey.extractKey!(v));
              else if (req.type === 'delete') keys = req.keys;
              const at = Date.now();
              const values: OutboxEntry[] = keys.filter((k) => typeof k === 'string').map((id) => ({ k: `${name}\u0001${id}`, tbl: name, id: id as string, at }));
              if (values.length) {
                await down.table('syncOutbox').mutate({ type: 'put', trans: req.trans, values });
                if (onLocalChange) setTimeout(onLocalChange, 0);
              }
              return res;
            },
          };
        },
      };
    },
  };
}

export class AppDB extends Dexie {
  products!: Table<Product, string>;
  priceItems!: Table<PriceItem, string>;
  stores!: Table<Store, string>;
  drafts!: Table<Draft, string>;
  orders!: Table<Order, string>;
  settings!: Table<Settings, string>;
  mappings!: Table<Mapping, string>;
  imports!: Table<ImportLog, string>;
  snapshots!: Table<Snapshot, string>;
  reports!: Table<WeeklyReport, string>;
  adjustments!: Table<OrderAdjustment, string>;
  syncOutbox!: Table<OutboxEntry, string>;
  syncMeta!: Table<SyncMetaRow, string>;

  constructor(name = 'a2z-order-app') {
    super(name);
    // Add a new this.version(2)... block here for future schema changes; never edit v1.
    this.version(1).stores({
      products: 'id, origin, department, priceItemId',
      priceItems: 'id, key',
      stores: 'id, name',
      drafts: 'storeId',
      orders: 'id, storeId, createdAt',
      settings: 'id',
      mappings: 'key',
      imports: 'id, at',
      snapshots: 'id, at',
    });
    // v2: weekly reports (primary key = unique report id, so a period can never be finalized twice)
    // and order adjustments (voids / resolved prices recorded after an order was finalized).
    this.version(2).stores({
      reports: 'id, periodKey, startUtc',
      adjustments: 'id, orderId, at',
    });
    // v3: cloud sync — changes waiting for upload, and sync state (cursor, device id)
    this.version(3).stores({
      syncOutbox: 'k, at',
      syncMeta: 'k',
    });
    // v4: the owner's product picture decisions (approved / rejected / his own photo), by product id
    this.version(4).stores({
      productImages: 'id',
    });
    // v5: product pictures were removed from the app (owner request 2026-11-22) — delete that table
    this.version(5).stores({
      productImages: null,
    });
    this.use(outboxMiddleware());
  }
}

export const DATA_TABLES = ['products', 'priceItems', 'stores', 'drafts', 'orders', 'settings', 'mappings', 'imports', 'reports', 'adjustments'] as const;
export type DataTable = (typeof DATA_TABLES)[number];

export let db = new AppDB();
/** Tests only. */
export function useDb(d: AppDB) {
  db = d;
}

/**
 * Same input → same id on every phone (53-bit cyrb53 hash, base 36). Used for products and price
 * lines that come from a document, so two synced phones that load the same catalog create the
 * same records instead of duplicates.
 */
export function stableId(prefix: string, key: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return prefix + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function uid(prefix = ''): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 18);
  return prefix + r;
}

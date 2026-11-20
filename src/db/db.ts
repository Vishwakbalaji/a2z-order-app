import Dexie, { type Table } from 'dexie';
import type { Draft, ImportLog, Mapping, Order, PriceItem, Product, Settings, Snapshot, Store } from '../types';

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
  }
}

export const DATA_TABLES = ['products', 'priceItems', 'stores', 'drafts', 'orders', 'settings', 'mappings', 'imports'] as const;
export type DataTable = (typeof DATA_TABLES)[number];

export let db = new AppDB();
/** Tests only. */
export function useDb(d: AppDB) {
  db = d;
}

export function uid(prefix = ''): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 18);
  return prefix + r;
}

import { db, uid, DATA_TABLES, type DataTable } from './db';

export const BACKUP_APP_ID = 'a2z-order-app';
export const BACKUP_VERSION = 2; // v2 adds weekly reports + order adjustments (v1 files still restore)

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  version: number;
  exportedAt: string;
  counts: Record<string, number>;
  tables: Record<DataTable, unknown[]>;
}

export async function exportBackup(): Promise<BackupFile> {
  const tables = {} as Record<DataTable, unknown[]>;
  const counts: Record<string, number> = {};
  await db.transaction('r', DATA_TABLES.map((t) => db.table(t)), async () => {
    for (const t of DATA_TABLES) {
      tables[t] = await db.table(t).toArray();
      counts[t] = tables[t].length;
    }
  });
  return { app: BACKUP_APP_ID, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), counts, tables };
}

const KEY_OF: Record<DataTable, string> = {
  products: 'id',
  priceItems: 'id',
  stores: 'id',
  drafts: 'storeId',
  orders: 'id',
  settings: 'id',
  mappings: 'key',
  imports: 'id',
  reports: 'id',
  adjustments: 'id',
};

/** Validates a backup file; returns a list of problems (empty = OK). */
export function validateBackup(data: unknown): string[] {
  const errs: string[] = [];
  const b = data as Partial<BackupFile>;
  if (!b || typeof b !== 'object') return ['Not a backup file.'];
  if (b.app !== BACKUP_APP_ID) errs.push('This file was not made by this app.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) errs.push('Unsupported backup version.');
  if (!b.tables || typeof b.tables !== 'object') return [...errs, 'Backup has no data.'];
  for (const t of DATA_TABLES) {
    const rows = (b.tables as Record<string, unknown>)[t];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) {
      errs.push(`"${t}" is not a list.`);
      continue;
    }
    const k = KEY_OF[t];
    const seen = new Set<unknown>();
    for (const r of rows) {
      const v = r && typeof r === 'object' ? (r as Record<string, unknown>)[k] : undefined;
      if (typeof v !== 'string' || !v) {
        errs.push(`A record in "${t}" has no ${k}.`);
        break;
      }
      if (seen.has(v)) {
        errs.push(`Duplicate ${k} in "${t}".`);
        break;
      }
      seen.add(v);
    }
  }
  if (!Array.isArray(b.tables.settings) || !b.tables.settings.length) errs.push('Backup has no settings record.');
  return errs;
}

/** Replace ALL data with the backup (a snapshot of the current data is kept first). */
export async function restoreBackup(data: BackupFile) {
  const errs = validateBackup(data);
  if (errs.length) throw new Error(errs.join(' '));
  await takeSnapshot('Before restoring a backup');
  await db.transaction('rw', DATA_TABLES.map((t) => db.table(t)), async () => {
    for (const t of DATA_TABLES) {
      await db.table(t).clear();
      const rows = data.tables[t] || [];
      if (rows.length) await db.table(t).bulkAdd(rows);
    }
  });
}

const MAX_SNAPSHOTS = 6;
/** Internal safety copy kept inside the browser before risky operations. */
export async function takeSnapshot(reason: string) {
  const b = await exportBackup();
  await db.snapshots.add({ id: uid('snap_'), at: Date.now(), reason, json: JSON.stringify(b) });
  const all = await db.snapshots.orderBy('at').toArray();
  if (all.length > MAX_SNAPSHOTS) await db.snapshots.bulkDelete(all.slice(0, all.length - MAX_SNAPSHOTS).map((s) => s.id));
}

export async function listSnapshots() {
  const all = await db.snapshots.orderBy('at').reverse().toArray();
  return all.map((s) => ({ id: s.id, at: s.at, reason: s.reason, size: s.json.length }));
}

export async function restoreSnapshot(id: string) {
  const s = await db.snapshots.get(id);
  if (!s) throw new Error('Snapshot not found');
  await restoreBackup(JSON.parse(s.json));
}

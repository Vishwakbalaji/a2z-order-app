/**
 * Sync protocol shared by the phone (src/sync/client.ts) and the cloud Worker (worker/src).
 *
 * Every record is (table, id) → JSON data. The cloud gives each write an ever-increasing
 * sequence number, so a phone downloads only what changed since its last sync ("since").
 * Merge rules (mergeRecord) protect what must never be lost:
 *   - finalized orders and order adjustments are append-only (never overwritten);
 *   - a finalized weekly report can only be marked "superseded" by a revision;
 *   - a store's first-order record (NEW STORE label used) can never be undone;
 *   - settings keep the highest order number counter;
 *   - everything else: the most recent change wins.
 */
export const SYNCED_TABLES = ['products', 'priceItems', 'stores', 'drafts', 'orders', 'settings', 'mappings', 'imports', 'reports', 'adjustments'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

/** A change sent by a phone. `at` = when it was changed on that phone (ms). */
export interface SyncChange {
  tbl: SyncedTable;
  id: string;
  data: Record<string, unknown> | null;
  deleted: boolean;
  at: number;
}
/** A record as stored in the cloud. */
export interface SyncRecord extends SyncChange {
  seq: number;
}

export interface SyncRequest {
  since: number;
  device: string;
  changes: SyncChange[];
}
export interface SyncResponse {
  seq: number; // highest sequence number in the cloud after this request
  stored: SyncRecord[]; // the cloud's version of every record this request pushed (after merging)
  changes: SyncRecord[]; // records changed after `since` (at most `limit`)
  hasMore: boolean;
  serverTime: number;
}

export const MAX_PUSH = 150; // records per request
export const MAX_PULL = 400;

const APPEND_ONLY = new Set<string>(['orders', 'adjustments']);

/** Returns the record to store, or null to keep the existing one unchanged. */
export function mergeRecord(existing: SyncChange | undefined, incoming: SyncChange): SyncChange | null {
  if (!existing) return incoming;
  if (APPEND_ONLY.has(incoming.tbl)) return null;
  if (incoming.tbl === 'reports') {
    const e = existing.data as { status?: string } | null;
    const i = incoming.data as { status?: string; supersededBy?: string } | null;
    if (e && i && e.status === 'final' && i.status === 'superseded' && i.supersededBy) {
      return { ...existing, data: { ...e, status: 'superseded', supersededBy: i.supersededBy }, at: Math.max(existing.at, incoming.at) };
    }
    return null; // finalized reports never change otherwise
  }
  const newer = incoming.at >= existing.at;
  if (incoming.tbl === 'stores' && existing.data && !existing.deleted) {
    const e = existing.data as { firstOrderId?: string | null; firstOrderAt?: number | null; isNew?: boolean };
    const base = newer ? incoming : existing;
    if (!base.data || base.deleted) return newer ? incoming : null;
    const i = (incoming.data || {}) as typeof e;
    // keep the earliest recorded first order
    const firsts = [e, i].filter((x) => x.firstOrderId).sort((a, b) => (a.firstOrderAt ?? 0) - (b.firstOrderAt ?? 0));
    const merged: Record<string, unknown> = { ...base.data };
    if (firsts.length) {
      merged.firstOrderId = firsts[0].firstOrderId;
      merged.firstOrderAt = firsts[0].firstOrderAt ?? null;
      merged.isNew = true;
    }
    const changed = newer || JSON.stringify(merged) !== JSON.stringify(existing.data);
    return changed ? { ...base, data: merged, at: Math.max(existing.at, incoming.at) } : null;
  }
  if (incoming.tbl === 'settings' && existing.data && incoming.data) {
    const base = newer ? incoming : existing;
    const orderSeq = Math.max(Number((existing.data as { orderSeq?: number }).orderSeq ?? 0), Number((incoming.data as { orderSeq?: number }).orderSeq ?? 0));
    const merged = { ...base.data, orderSeq };
    const changed = newer || JSON.stringify(merged) !== JSON.stringify(existing.data);
    return changed ? { ...base, data: merged, at: Math.max(existing.at, incoming.at) } : null;
  }
  return newer ? incoming : null;
}

/** Fields that belong to one phone only and are never taken from the cloud. */
export const DEVICE_LOCAL_SETTINGS = ['selectedStoreId', 'dataNotice'] as const;

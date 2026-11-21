import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { AppDB, useDb, db, REMOTE_TAG, stableId } from '../src/db/db';
import { mergeRecord, type SyncChange } from '../src/sync/protocol';
import { BUNDLED_DATASETS } from '../src/data/bundled';
import * as S from '../src/state/store';

BUNDLED_DATASETS.splice(1);

const rec = (tbl: SyncChange['tbl'], id: string, data: Record<string, unknown> | null, at: number, deleted = false): SyncChange => ({ tbl, id, data, deleted, at });

describe('cloud merge rules', () => {
  it('finalized orders and adjustments are never overwritten', () => {
    expect(mergeRecord(rec('orders', 'o1', { v: 1 }, 1), rec('orders', 'o1', { v: 2 }, 9))).toBeNull();
    expect(mergeRecord(rec('adjustments', 'a1', { v: 1 }, 1), rec('adjustments', 'a1', null, 9, true))).toBeNull();
    expect(mergeRecord(undefined, rec('orders', 'o2', { v: 1 }, 1))).toEqual(rec('orders', 'o2', { v: 1 }, 1));
  });
  it('a finalized weekly report can only be marked superseded; the first finalized version wins', () => {
    const fin = rec('reports', 'WR-2026-11-21', { status: 'final', data: { salesCents: 100 } }, 1);
    expect(mergeRecord(fin, rec('reports', 'WR-2026-11-21', { status: 'final', data: { salesCents: 999 } }, 5))).toBeNull();
    const sup = mergeRecord(fin, rec('reports', 'WR-2026-11-21', { status: 'superseded', supersededBy: 'WR-2026-11-21-R1', data: { salesCents: 999 } }, 5))!;
    expect(sup.data).toEqual({ status: 'superseded', supersededBy: 'WR-2026-11-21-R1', data: { salesCents: 100 } });
  });
  it('a store’s first-order record can never be undone, even by a newer edit from another phone', () => {
    const a = rec('stores', 's1', { name: 'ABC', isNew: true, firstOrderId: 'o1', firstOrderAt: 50 }, 100);
    const b = mergeRecord(a, rec('stores', 's1', { name: 'ABC Renamed', isNew: true, firstOrderId: null }, 200))!;
    expect(b.data).toMatchObject({ name: 'ABC Renamed', firstOrderId: 'o1', firstOrderAt: 50 });
    // two phones offline both used the first order: the earliest one is kept
    const c = mergeRecord(a, rec('stores', 's1', { name: 'ABC', isNew: true, firstOrderId: 'o0', firstOrderAt: 40 }, 90))!;
    expect(c.data).toMatchObject({ firstOrderId: 'o0', firstOrderAt: 40 });
    // an older edit of a store without first order changes nothing
    expect(mergeRecord(rec('stores', 's2', { name: 'X' }, 100), rec('stores', 's2', { name: 'old' }, 50))).toBeNull();
  });
  it('settings keep the highest order counter; everything else: latest change wins', () => {
    const m = mergeRecord(rec('settings', 'app', { repPhone: 'a', orderSeq: 7 }, 100), rec('settings', 'app', { repPhone: 'b', orderSeq: 3 }, 200))!;
    expect(m.data).toEqual({ repPhone: 'b', orderSeq: 7 });
    expect(mergeRecord(rec('drafts', 's1', { lines: [1] }, 200), rec('drafts', 's1', { lines: [] }, 100))).toBeNull();
    expect(mergeRecord(rec('drafts', 's1', { lines: [1] }, 100), rec('drafts', 's1', { lines: [] }, 200))!.data).toEqual({ lines: [] });
    expect(mergeRecord(rec('stores', 's1', { name: 'A' }, 100), rec('stores', 's1', null, 200, true))).toMatchObject({ deleted: true });
  });
});

describe('outbox (changes waiting for upload)', () => {
  it('records every local change in the same transaction, but not changes that came from the cloud', async () => {
    useDb(new AppDB('sync-1'));
    await S.init();
    const n0 = await db.syncOutbox.count();
    expect(n0).toBeGreaterThan(131); // seeded price sheet + settings are queued for a first upload
    await db.syncOutbox.clear();
    const s = await S.saveStore({ name: 'Out Box', address: '1 St' });
    expect((await db.syncOutbox.get(`stores\u0001${s.id}`))?.tbl).toBe('stores');
    // a transaction that only lists other tables still records the outbox entry atomically
    await db.transaction('rw', db.orders, async () => {
      await db.orders.put({ id: 'o_test', orderNo: 'X', storeId: s.id } as never);
    });
    expect(await db.syncOutbox.get('orders\u0001o_test')).toBeTruthy();
    // deletes are recorded too
    await S.deleteStore(s.id);
    expect(await db.syncOutbox.get(`stores\u0001${s.id}`)).toBeTruthy();
    // writes tagged as coming from the cloud are not sent back
    await db.syncOutbox.clear();
    await db.transaction('rw', db.stores, async (tx) => {
      (tx.idbtrans as unknown as Record<string, unknown>)[REMOTE_TAG] = true;
      await db.stores.put({ id: 's_remote', name: 'From cloud' } as never);
    });
    expect(await db.syncOutbox.count()).toBe(0);
    // non-synced tables (safety snapshots) are never queued
    await db.snapshots.put({ id: 'snap_x', at: 1, reason: 'x', json: '{}' });
    expect(await db.syncOutbox.count()).toBe(0);
  });
  it('the same catalog creates the same ids on every phone (no duplicates when syncing)', async () => {
    useDb(new AppDB('sync-phone-a'));
    await S.init();
    const a = S.getState().products.map((p) => p.id).sort();
    useDb(new AppDB('sync-phone-b'));
    await S.init();
    const b = S.getState().products.map((p) => p.id).sort();
    expect(a).toEqual(b);
    expect(stableId('p_', 'X')).toBe(stableId('p_', 'X'));
    expect(stableId('p_', 'X')).not.toBe(stableId('p_', 'Y'));
  });
});

/**
 * Cloud sync on the phone.
 *  - Every local change is already in the outbox (see outboxMiddleware in src/db/db.ts).
 *  - syncNow(): upload the outbox, apply the cloud's merged versions, then download everything
 *    changed since the last sync ("cursor"). Runs on open, every 30 s, after changes (2 s later),
 *    when the app comes back to the foreground and when the phone gets back online.
 *  - The access key lives only on your phones (localStorage + IndexedDB). It is never part of
 *    the website and never sent anywhere except to your own sync service.
 */
import { useSyncExternalStore } from 'react';
import { db, DATA_TABLES, REMOTE_TAG, setLocalChangeListener } from '../db/db';
import { takeSnapshot } from '../db/backup';
import { DEVICE_LOCAL_SETTINGS, MAX_PUSH, SYNCED_TABLES, type SyncChange, type SyncRecord, type SyncResponse } from './protocol';

const KNOWN = new Set<string>(SYNCED_TABLES); // records of removed features (e.g. old product pictures) are skipped
import { SYNC_URL } from '../config';

const KEY_LS = 'a2z-sync-key';
const DEVICE_LS = 'a2z-device-id';

export interface SyncStatus {
  configured: boolean; // a sync service URL exists in this build
  enabled: boolean; // this phone has a key
  syncing: boolean;
  lastSyncAt: number | null;
  pending: number;
  error: string | null;
}
let status: SyncStatus = { configured: !!SYNC_URL, enabled: false, syncing: false, lastSyncAt: null, pending: 0, error: null };
const listeners = new Set<() => void>();
function setStatus(p: Partial<SyncStatus>) {
  status = { ...status, ...p };
  listeners.forEach((l) => l());
}
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

export function syncUrl(): string {
  try {
    return localStorage.getItem('a2z-sync-url') || SYNC_URL; // override only used by automated tests
  } catch {
    return SYNC_URL;
  }
}

/* ------------------------------ key & device ------------------------------ */

export function newKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function meta<T>(k: string): Promise<T | undefined> {
  return (await db.syncMeta.get(k))?.v as T | undefined;
}
async function setMeta(k: string, v: unknown) {
  await db.syncMeta.put({ k, v });
}
export async function getKey(): Promise<string | null> {
  try {
    const k = localStorage.getItem(KEY_LS);
    if (k) return k;
  } catch {
    /* ignore */
  }
  return (await meta<string>('key')) ?? null;
}
async function saveKey(key: string | null) {
  try {
    if (key) localStorage.setItem(KEY_LS, key);
    else localStorage.removeItem(KEY_LS);
  } catch {
    /* ignore */
  }
  if (key) await setMeta('key', key);
  else await db.syncMeta.delete('key');
  setStatus({ enabled: !!key });
}
function deviceId(): string {
  try {
    let d = localStorage.getItem(DEVICE_LS);
    if (!d) {
      d = newKey().slice(0, 12);
      localStorage.setItem(DEVICE_LS, d);
    }
    return d;
  } catch {
    return 'phone';
  }
}
export function pairingLink(key: string): string {
  const base = location.href.split('#')[0];
  return `${base}#/pair/${key}`;
}

/* ------------------------------ HTTP ------------------------------ */

async function api<T>(path: string, body?: unknown, key?: string | null): Promise<T> {
  const url = syncUrl();
  if (!url) throw new Error('Cloud sync is not set up in this version of the app.');
  const res = await fetch(url.replace(/\/$/, '') + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error || `Sync service error ${res.status}`), { status: res.status });
  return data;
}

/* ------------------------------ apply cloud data ------------------------------ */

let onApplied: (() => Promise<void> | void) | null = null;
/** Called after cloud data changed something locally (the app reloads its state). */
export function setOnApplied(fn: (() => Promise<void> | void) | null) {
  onApplied = fn;
}

async function applyRemote(records: SyncRecord[]): Promise<number> {
  if (!records.length) return 0;
  let applied = 0;
  await db.transaction('rw', [...DATA_TABLES.map((t) => db.table(t)), db.syncOutbox], async (tx) => {
    (tx.idbtrans as unknown as Record<string, unknown>)[REMOTE_TAG] = true; // don't send these back
    const pending = new Set((await db.syncOutbox.toCollection().primaryKeys()) as string[]);
    for (const r of records) {
      if (!KNOWN.has(r.tbl)) continue; // a table this app version no longer has
      if (pending.has(`${r.tbl}\u0001${r.id}`)) continue; // a newer local change will be uploaded
      const table = db.table(r.tbl);
      if (r.deleted || !r.data) {
        await table.delete(r.id);
      } else if (r.tbl === 'settings') {
        const local = (await table.get(r.id)) as Record<string, unknown> | undefined;
        const merged: Record<string, unknown> = { ...r.data };
        for (const k of DEVICE_LOCAL_SETTINGS) if (local && k in local) merged[k] = local[k];
        else if (!local) delete merged[k];
        merged.bundledVersion = Math.max(Number(local?.bundledVersion ?? 0), Number(r.data.bundledVersion ?? 0));
        await table.put(merged);
      } else {
        await table.put(r.data);
      }
      applied++;
    }
  });
  return applied;
}

/* ------------------------------ sync ------------------------------ */

let running: Promise<void> | null = null;
let again = false;

export async function refreshPending() {
  setStatus({ pending: await db.syncOutbox.count() });
}

/** Upload local changes and download cloud changes. Safe to call any time (single flight). */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await syncOnce();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncOnce() {
  const key = await getKey();
  setStatus({ enabled: !!key, configured: !!syncUrl() });
  if (!key || !syncUrl()) return;
  setStatus({ syncing: true });
  try {
    let changedLocally = 0;
    for (let round = 0; round < 200; round++) {
      const stale = (await db.syncOutbox.toArray()).filter((o) => !KNOWN.has(o.tbl)).map((o) => o.k);
      if (stale.length) await db.syncOutbox.bulkDelete(stale); // changes to removed tables are not sent
      const outbox = await db.syncOutbox.orderBy('at').limit(MAX_PUSH).toArray();
      const changes: SyncChange[] = [];
      for (const o of outbox) {
        const data = (await db.table(o.tbl).get(o.id)) as Record<string, unknown> | undefined;
        changes.push({ tbl: o.tbl as SyncChange['tbl'], id: o.id, data: data ?? null, deleted: !data, at: o.at });
      }
      const since = (await meta<number>('cursor')) ?? 0;
      const res = await api<SyncResponse>('/sync', { since, device: deviceId(), changes }, key);
      // pushed: remove outbox entries that did not change while we were uploading
      await db.transaction('rw', db.syncOutbox, async () => {
        for (const o of outbox) {
          const cur = await db.syncOutbox.get(o.k);
          if (cur && cur.at === o.at) await db.syncOutbox.delete(o.k);
        }
      });
      changedLocally += await applyRemote([...res.stored, ...res.changes]);
      const maxSeq = res.changes.reduce((m, r) => Math.max(m, r.seq), since);
      await setMeta('cursor', maxSeq);
      const left = await db.syncOutbox.count();
      if (!res.hasMore && left === 0) break;
    }
    setStatus({ lastSyncAt: Date.now(), error: null });
    await setMeta('lastSyncAt', Date.now());
    if (changedLocally && onApplied) await onApplied();
  } catch (e) {
    const err = e as Error & { status?: number };
    setStatus({ error: err.status === 401 ? 'This phone’s sync key is no longer valid (it was changed on another phone). Pair again.' : navigator.onLine === false ? 'Offline — changes are saved on this phone and will upload when you are back online.' : err.message });
  } finally {
    setStatus({ syncing: false });
    await refreshPending();
  }
}

/* ------------------------------ turning sync on ------------------------------ */

/** First phone: claim the cloud database and upload everything on this phone. */
export async function enableAsFirstPhone(): Promise<{ ok: true } | { ok: false; alreadySetUp: true }> {
  const key = newKey();
  try {
    await api('/claim', { key });
  } catch (e) {
    if ((e as { status?: number }).status === 409) return { ok: false, alreadySetUp: true };
    throw e;
  }
  await saveKey(key);
  await setMeta('cursor', 0);
  // queue every record for upload
  const at = Date.now();
  for (const t of DATA_TABLES) {
    const ids = (await db.table(t).toCollection().primaryKeys()) as string[];
    await db.syncOutbox.bulkPut(ids.map((id) => ({ k: `${t}\u0001${id}`, tbl: t, id, at })));
  }
  await refreshPending();
  await syncNow();
  return { ok: true };
}

/**
 * Another phone (or a re-installed one): replace this phone's data with the cloud data.
 * A safety snapshot of this phone's data is kept first.
 */
export async function pairWithKey(key: string): Promise<void> {
  const st = await api<{ claimed: boolean; authorized: boolean }>('/status', undefined, key);
  if (!st.authorized) throw new Error('That sync key is not valid. Check it, or create a new pairing link on your other phone.');
  await takeSnapshot('Before connecting this phone to cloud data');
  await db.transaction('rw', [...DATA_TABLES.map((t) => db.table(t)), db.syncOutbox], async (tx) => {
    (tx.idbtrans as unknown as Record<string, unknown>)[REMOTE_TAG] = true;
    for (const t of DATA_TABLES) await db.table(t).clear();
    await db.syncOutbox.clear();
  });
  await setMeta('cursor', 0);
  await saveKey(key);
  await syncNow();
  if (onApplied) await onApplied();
}

/** Stop syncing on this phone (data stays on the phone). */
export async function disableOnThisPhone() {
  await saveKey(null);
  setStatus({ error: null });
}

/** New key for all phones (e.g. a phone was lost). Other phones must be paired again. */
export async function rotateKey(): Promise<string> {
  const old = await getKey();
  if (!old) throw new Error('Cloud sync is not on.');
  const key = newKey();
  await api('/rotate', { newKey: key }, old);
  await saveKey(key);
  return key;
}

/* ------------------------------ background triggers ------------------------------ */

let debounce: ReturnType<typeof setTimeout> | undefined;
export function startSyncLoop() {
  setLocalChangeListener(() => {
    void refreshPending();
    clearTimeout(debounce);
    debounce = setTimeout(() => void syncNow(), 2000);
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  window.addEventListener('online', () => void syncNow());
  void (async () => {
    setStatus({ enabled: !!(await getKey()), lastSyncAt: (await meta<number>('lastSyncAt')) ?? null });
    await refreshPending();
  })();
}

/** Used before weekly reports are finalized on the phone, so they include other phones' orders. */
export async function syncBeforeReports(timeoutMs = 8000) {
  if (!(await getKey())) return;
  await Promise.race([syncNow(), new Promise((r) => setTimeout(r, timeoutMs))]);
}

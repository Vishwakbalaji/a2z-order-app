/**
 * A2Z Order Pad — cloud sync API + Friday weekly-report job (Cloudflare Worker + D1).
 *
 * Access: no login. The first phone that turns on sync "claims" the database with a long random
 * key that only exists on your phones; the database stores only its SHA-256 hash. Every request
 * must carry that key (Authorization: Bearer <key>). No secret is ever part of the website.
 */
import { MAX_PULL, MAX_PUSH, SYNCED_TABLES, mergeRecord, type SyncChange, type SyncRecord, type SyncRequest, type SyncResponse } from '../../src/sync/protocol';
import { buildReportRecord } from '../../src/lib/reports';
import { closedWeeks } from '../../src/lib/week';
import type { Order, OrderAdjustment, Settings, Store, WeeklyReport } from '../../src/types';

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  TEST_MODE?: string; // only set by the local test server
}

const TABLES = new Set<string>(SYNCED_TABLES);

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  return allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : { Vary: 'Origin' };
}
function json(req: Request, env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req, env) } });
}

async function meta(env: Env, k: string): Promise<string | null> {
  const r = await env.DB.prepare('SELECT v FROM meta WHERE k = ?').bind(k).first<{ v: string }>();
  return r?.v ?? null;
}

async function authorized(req: Request, env: Env): Promise<boolean> {
  const m = /^Bearer\s+([A-Za-z0-9_-]{32,128})$/.exec(req.headers.get('Authorization') || '');
  if (!m) return false;
  const stored = await meta(env, 'keyhash');
  return !!stored && timingSafeEqual(await sha256(m[1]), stored);
}

function rowToRecord(r: { tbl: string; id: string; data: string | null; deleted: number; seq: number; at: number }): SyncRecord {
  return { tbl: r.tbl as SyncRecord['tbl'], id: r.id, data: r.data ? JSON.parse(r.data) : null, deleted: !!r.deleted, seq: r.seq, at: r.at };
}

async function loadExisting(env: Env, keys: { tbl: string; id: string }[]): Promise<Map<string, SyncRecord>> {
  const out = new Map<string, SyncRecord>();
  for (let i = 0; i < keys.length; i += 45) {
    const part = keys.slice(i, i + 45);
    const where = part.map(() => '(tbl = ? AND id = ?)').join(' OR ');
    const res = await env.DB.prepare(`SELECT tbl, id, data, deleted, seq, at FROM records WHERE ${where}`)
      .bind(...part.flatMap((k) => [k.tbl, k.id]))
      .all<{ tbl: string; id: string; data: string | null; deleted: number; seq: number; at: number }>();
    for (const r of res.results) out.set(`${r.tbl}\u0001${r.id}`, rowToRecord(r));
  }
  return out;
}

/** Writes records atomically, each with the next sequence number (one D1 batch = one transaction). */
async function writeRecords(env: Env, recs: SyncChange[], device: string): Promise<void> {
  if (!recs.length) return;
  const n = recs.length;
  const stmts: D1PreparedStatement[] = [env.DB.prepare("UPDATE meta SET v = CAST(v AS INTEGER) + ? WHERE k = 'seq'").bind(n)];
  recs.forEach((r, i) => {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO records (tbl, id, data, deleted, seq, at, device)
         VALUES (?, ?, ?, ?, (SELECT CAST(v AS INTEGER) FROM meta WHERE k = 'seq') - ?, ?, ?)
         ON CONFLICT (tbl, id) DO UPDATE SET data = excluded.data, deleted = excluded.deleted, seq = excluded.seq, at = excluded.at, device = excluded.device`,
      ).bind(r.tbl, r.id, r.deleted ? null : JSON.stringify(r.data), r.deleted ? 1 : 0, n - 1 - i, r.at, device),
    );
  });
  await env.DB.batch(stmts);
}

async function sync(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as SyncRequest;
  const since = Number.isFinite(body.since) ? Number(body.since) : 0;
  const device = String(body.device || '').slice(0, 64);
  const changes = Array.isArray(body.changes) ? body.changes.slice(0, MAX_PUSH) : [];
  for (const c of changes) {
    if (!TABLES.has(c.tbl) || typeof c.id !== 'string' || !c.id || c.id.length > 200 || typeof c.at !== 'number') return json(req, env, { error: 'bad change' }, 400);
  }
  // merge with what the cloud already has
  const existing = await loadExisting(env, changes);
  const toWrite: SyncChange[] = [];
  const seen = new Set<string>();
  for (const c of changes) {
    const k = `${c.tbl}\u0001${c.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const m = mergeRecord(existing.get(k), { tbl: c.tbl, id: c.id, data: c.deleted ? null : c.data, deleted: !!c.deleted, at: c.at });
    if (m) toWrite.push(m);
  }
  await writeRecords(env, toWrite, device);
  const stored = changes.length ? [...(await loadExisting(env, changes)).values()] : [];
  const pull = await env.DB.prepare('SELECT tbl, id, data, deleted, seq, at FROM records WHERE seq > ? ORDER BY seq LIMIT ?')
    .bind(since, MAX_PULL + 1)
    .all<{ tbl: string; id: string; data: string | null; deleted: number; seq: number; at: number }>();
  const rows = pull.results.map(rowToRecord);
  const hasMore = rows.length > MAX_PULL;
  const res: SyncResponse = {
    seq: Number((await meta(env, 'seq')) ?? 0),
    stored,
    changes: rows.slice(0, MAX_PULL),
    hasMore,
    serverTime: Date.now(),
  };
  return json(req, env, res);
}

/** Finalizes every reporting week that has ended and has no report yet (idempotent). */
export async function finalizeWeeklyReports(env: Env, now = Date.now()): Promise<string[]> {
  const res = await env.DB.prepare("SELECT tbl, id, data FROM records WHERE deleted = 0 AND tbl IN ('stores','orders','adjustments','settings','reports')").all<{ tbl: string; id: string; data: string }>();
  const by: Record<string, unknown[]> = { stores: [], orders: [], adjustments: [], settings: [], reports: [] };
  for (const r of res.results) by[r.tbl].push(JSON.parse(r.data));
  const have = new Set((by.reports as WeeklyReport[]).map((r) => r.periodKey));
  const settings = (by.settings as Settings[])[0];
  if (!settings) return []; // nothing synced yet
  const created: WeeklyReport[] = [];
  for (const week of closedWeeks(now)) {
    if (have.has(week.key)) continue;
    created.push(buildReportRecord({ week, stores: by.stores as Store[], orders: by.orders as Order[], adjustments: by.adjustments as OrderAdjustment[], settings, revision: 0, generatedBy: 'auto', status: 'final', now }));
  }
  if (!created.length) return [];
  // insert-only: if a phone finalized the same week a moment earlier, its report is kept
  const existing = await loadExisting(env, created.map((r) => ({ tbl: 'reports', id: r.id })));
  const fresh = created.filter((r) => !existing.has(`reports\u0001${r.id}`));
  await writeRecords(env, fresh.map((r) => ({ tbl: 'reports', id: r.id, data: r as unknown as Record<string, unknown>, deleted: false, at: now })), 'cloud-schedule');
  await env.DB.prepare('INSERT INTO cron_runs (at, created) VALUES (?, ?)').bind(now, fresh.map((r) => r.id).join(',')).run();
  return fresh.map((r) => r.id);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req, env) });
    try {
      if (url.pathname === '/status' && req.method === 'GET') {
        const claimed = !!(await meta(env, 'keyhash'));
        const authed = claimed && (await authorized(req, env));
        return json(req, env, { ok: true, claimed, authorized: authed, serverTime: Date.now() });
      }
      if (url.pathname === '/claim' && req.method === 'POST') {
        const { key } = (await req.json()) as { key?: string };
        if (!key || !/^[A-Za-z0-9_-]{32,128}$/.test(key)) return json(req, env, { error: 'bad key' }, 400);
        const r = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('keyhash', ?)").bind(await sha256(key)).run();
        if (!r.meta.changes) return json(req, env, { error: 'already set up — use "Add another phone" on your first phone' }, 409);
        await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('claimedAt', ?)").bind(String(Date.now())).run();
        return json(req, env, { ok: true });
      }
      if (!(await authorized(req, env))) return json(req, env, { error: 'unauthorized' }, 401);
      if (url.pathname === '/sync' && req.method === 'POST') return await sync(req, env);
      if (url.pathname === '/rotate' && req.method === 'POST') {
        const { newKey } = (await req.json()) as { newKey?: string };
        if (!newKey || !/^[A-Za-z0-9_-]{32,128}$/.test(newKey)) return json(req, env, { error: 'bad key' }, 400);
        await env.DB.prepare("UPDATE meta SET v = ? WHERE k = 'keyhash'").bind(await sha256(newKey)).run();
        return json(req, env, { ok: true });
      }
      if (url.pathname === '/run-reports' && req.method === 'POST') {
        // automated tests may simulate a different time; never possible on the real deployment
        const body = (await req.json().catch(() => ({}))) as { now?: number };
        const now = env.TEST_MODE === '1' && typeof body.now === 'number' ? body.now : Date.now();
        return json(req, env, { created: await finalizeWeeklyReports(env, now) });
      }
      return json(req, env, { error: 'not found' }, 404);
    } catch (e) {
      return json(req, env, { error: (e as Error).message || 'server error' }, 500);
    }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(finalizeWeeklyReports(env).then(() => undefined));
  },
};

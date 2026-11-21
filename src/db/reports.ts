/**
 * Weekly reports in the database.
 *  - A finalized report is an immutable snapshot. Its id is unique per period and revision
 *    ("WR-2026-11-21", "WR-2026-11-21-R1"), and it is written with `add`, so the same week
 *    can never be finalized twice — even if two tabs or two triggers run at the same moment.
 *  - Corrections create a NEW revision; the original is kept and marked "superseded".
 *  - The week still in progress is only ever shown as a provisional report (never saved).
 */
import { db } from './db';
import type { WeeklyReport } from '../types';
import { closedWeeks, weekFromKey, weekOf, REPORT_START, type Week } from '../lib/week';
import { buildReportRecord, reportChanged, reportId } from '../lib/reports';

export { reportId };

async function build(week: Week, opts: { revision: number; generatedBy: 'auto' | 'manual'; status: WeeklyReport['status']; now: number; reason?: string; supersedes?: string | null }): Promise<WeeklyReport> {
  const [stores, orders, adjustments, settings] = await Promise.all([db.stores.toArray(), db.orders.toArray(), db.adjustments.toArray(), db.settings.get('app')]);
  return buildReportRecord({ week, stores, orders, adjustments, settings, ...opts });
}

/**
 * Finalizes every closed week that has no report yet (the app calls this when it opens, every
 * minute while it is open, and when it comes back to the foreground). Safe to call any number
 * of times: it never creates a second report for a week and never changes an existing one.
 */
export async function ensureWeeklyReports(now = Date.now(), reportStart = REPORT_START): Promise<string[]> {
  const run = async () => {
    const created: string[] = [];
    for (const week of closedWeeks(now, reportStart)) {
      if ((await db.reports.where('periodKey').equals(week.key).count()) > 0) continue;
      const rep = await build(week, { revision: 0, generatedBy: 'auto', status: 'final', now });
      try {
        await db.reports.add(rep); // unique id → a duplicate is rejected by the database
        created.push(rep.id);
      } catch (e) {
        if ((e as Error).name !== 'ConstraintError') throw e;
      }
    }
    return created;
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request('a2z-weekly-reports', run) : run();
}

/** The current (open) week as a provisional report. Nothing is saved. */
export async function provisionalReport(now = Date.now(), reportStart = REPORT_START): Promise<WeeklyReport | null> {
  const week = weekOf(now, reportStart);
  if (week.number < 1) return null; // before week 1
  return build(week, { revision: 0, generatedBy: 'manual', status: 'provisional', now });
}

/** Latest revision of every finalized week, newest first. */
export async function listLatestReports(): Promise<WeeklyReport[]> {
  const all = await db.reports.toArray();
  const latest = new Map<string, WeeklyReport>();
  for (const r of all) if (!latest.has(r.periodKey) || latest.get(r.periodKey)!.revision < r.revision) latest.set(r.periodKey, r);
  return [...latest.values()].sort((a, b) => b.startUtc - a.startUtc);
}

export async function reportHistory(periodKey: string): Promise<WeeklyReport[]> {
  return (await db.reports.where('periodKey').equals(periodKey).toArray()).sort((a, b) => a.revision - b.revision);
}

/** Does a fresh calculation for this finalized week differ from its snapshot? */
export async function changedSince(report: WeeklyReport, now = Date.now()): Promise<boolean> {
  const fresh = await build(weekFromKey(report.periodKey), { revision: report.revision, generatedBy: 'manual', status: 'provisional', now });
  return reportChanged(report.data, fresh.data);
}

/** Creates a clearly identified revised report; the previous version is kept (superseded). */
export async function createRevision(periodKey: string, reason: string, now = Date.now()): Promise<WeeklyReport> {
  if (!reason.trim()) throw new Error('Please give a reason for the revision.');
  return db.transaction('rw', db.reports, db.stores, db.orders, db.adjustments, db.settings, async () => {
    const hist = await reportHistory(periodKey);
    const prev = hist[hist.length - 1];
    if (!prev) throw new Error('This week has no finalized report yet.');
    const week = weekFromKey(periodKey);
    const rev = await build(week, { revision: prev.revision + 1, generatedBy: 'manual', status: 'final', now, reason: reason.trim(), supersedes: prev.id });
    rev.weekNumber = prev.weekNumber;
    await db.reports.add(rev);
    await db.reports.put({ ...prev, status: 'superseded', supersededBy: rev.id });
    return rev;
  });
}

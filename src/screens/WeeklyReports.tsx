import { useEffect, useState } from 'react';
import { Badge, Card, Empty, Icon, PageHeader, btnPrimary, btnSecondary, promptDialog, toast } from '../components/ui';
import { OrdersTabs } from './Orders';
import { useApp } from '../state/store';
import { changedSince, createRevision, listLatestReports, provisionalReport, reportHistory } from '../db/reports';
import { db } from '../db/db';
import { buildWeeklyReportPdf } from '../lib/reportPdf';
import { canShareFiles, downloadBlob, shareFile } from '../lib/download';
import { formatCents } from '../lib/money';
import { formatDay, formatNy, formatPeriod, weekOf, REPORT_START } from '../lib/week';
import type { WeeklyReport } from '../types';

/* ------------------------------ list + current week ------------------------------ */

export function WeeklyReportsScreen() {
  const version = useApp((s) => s.reportsVersion);
  const [reports, setReports] = useState<WeeklyReport[] | null>(null);
  const [current, setCurrent] = useState<WeeklyReport | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    listLatestReports().then(setReports);
    provisionalReport().then(setCurrent);
  }, [version]);
  const now = Date.now();
  const week = weekOf(now);
  const beforeStart = week.number < 1;
  const ql = q.trim().toLowerCase();
  const list = (reports || []).filter((r) => {
    if (!ql) return true;
    const hay = `week ${r.weekNumber} ${r.id} ${r.start} ${r.end} ${formatPeriod(r)} ${formatDay(r.start, { month: 'long', day: 'numeric' })} ${formatDay(r.end, { month: 'long', day: 'numeric' })}`.toLowerCase();
    return hay.includes(ql) || (/^\d+$/.test(ql) && String(r.weekNumber) === ql);
  });
  return (
    <div>
      <PageHeader title="Orders" />
      <OrdersTabs active="reports" />
      <div className="p-3 space-y-3">
        <Card className="p-4">
          <div className="text-xs font-bold uppercase text-gray-500">This week {beforeStart ? '' : `· Week ${week.number}`}</div>
          <div className="font-semibold">{formatPeriod(week)} (Sat–Fri, New York time)</div>
          {beforeStart ? (
            <p className="text-sm text-gray-600 mt-1">Weekly reports start with Week 1 on {formatDay(REPORT_START, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.</p>
          ) : current ? (
            <>
              <div className="grid grid-cols-3 gap-2 text-center mt-3">
                <Metric label="Orders" value={String(current.data.ordersCount)} />
                <Metric label="Sales" value={formatCents(current.data.salesCents)} />
                <Metric label="My 1%" value={formatCents(current.data.commissionCents)} accent />
              </div>
              <p className="text-xs text-gray-500 mt-2">The final report is created automatically after Friday 11:59:59 PM (New York).</p>
              <a href="#/reports/current" className={`${btnSecondary} w-full mt-3`} data-testid="generate-report">
                <Icon name="history" /> Generate Weekly Report (provisional)
              </a>
            </>
          ) : null}
        </Card>

        <h2 className="font-bold px-1 pt-1">Weekly Report History</h2>
        {(reports?.length || 0) > 3 && <input type="search" placeholder="Search by week number or date (e.g. 3, Dec 5)" value={q} onChange={(e) => setQ(e.target.value)} className="w-full h-11 px-3 rounded-xl border border-gray-300 bg-white" aria-label="Search weekly reports" />}
        {reports && !reports.length && (
          <Empty title="No finalized weekly reports yet">
            <p>Each week (Saturday–Friday) is finalized automatically once it ends, the next time the app is open.</p>
          </Empty>
        )}
        {list.length > 0 && (
          <Card className="overflow-hidden">
            <table className="w-full text-sm" data-testid="report-history">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left p-2">Week</th>
                  <th className="text-left p-2">Period</th>
                  <th className="text-right p-2">Sales</th>
                  <th className="text-right p-2">Commission</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="p-2">
                      <a href={`#/reports/${r.id}`} className="text-brand font-semibold underline">
                        Week {r.weekNumber}
                      </a>
                      {r.revision > 0 && (
                        <div>
                          <Badge tone="amber">Revised R{r.revision}</Badge>
                        </div>
                      )}
                    </td>
                    <td className="p-2">{formatPeriod(r)}</td>
                    <td className="p-2 text-right tabular-nums">{formatCents(r.data.salesCents)}</td>
                    <td className="p-2 text-right tabular-nums font-semibold">{formatCents(r.data.commissionCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`font-bold tabular-nums ${accent ? 'text-brand' : ''}`}>{value}</div>
    </div>
  );
}

/* ------------------------------ one report ------------------------------ */

export function WeeklyReportScreen({ id }: { id: string }) {
  const version = useApp((s) => s.reportsVersion);
  const logo = useApp((s) => s.settings.logoDataUrl);
  const [r, setR] = useState<WeeklyReport | null | undefined>(undefined);
  const [history, setHistory] = useState<WeeklyReport[]>([]);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      const rep = id === 'current' ? await provisionalReport() : (await db.reports.get(id)) ?? null;
      setR(rep);
      if (rep && rep.status !== 'provisional') {
        setHistory(await reportHistory(rep.periodKey));
        setChanged(rep.status === 'final' && (await changedSince(rep)));
      }
    })();
  }, [id, version]);
  if (r === undefined) return <PageHeader title="Weekly Report" back="#/reports" />;
  if (!r) return <><PageHeader title="Weekly Report" back="#/reports" /><Empty title="Report not found" /></>;
  const d = r.data;
  const firstWeek = d.nonOrdering === null;
  const pdf = async (mode: 'download' | 'share') => {
    setBusy(true);
    try {
      const { blob, filename } = await buildWeeklyReportPdf(r, logo);
      if (mode === 'share' && (await shareFile(blob, filename, filename))) return;
      downloadBlob(blob, filename);
      toast(`Downloaded ${filename}`);
    } catch (e) {
      toast('Could not create the PDF: ' + (e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={`Week ${r.weekNumber} Report`} back="#/reports" />
      <div className="p-3 space-y-3">
        {r.status === 'provisional' && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-sm" role="status">
            <b>PROVISIONAL.</b> This week is still in progress, so these numbers can change. The final report is created automatically after Friday 11:59:59 PM (New York).
          </div>
        )}
        {r.status === 'superseded' && (
          <div className="p-3 rounded-xl bg-gray-100 border border-gray-300 text-sm">
            This version was replaced by <a className="text-brand underline font-semibold" href={`#/reports/${r.supersededBy}`}>{r.supersededBy}</a>. It is kept unchanged for your records.
          </div>
        )}
        {changed && (
          <div className="p-3 rounded-xl bg-blue-50 border border-blue-300 text-sm">
            Something changed for this week after it was finalized (for example an order was voided or a missing price was added). This report is unchanged. If you need the corrected numbers, create a revised report — this version will be kept.
          </div>
        )}
        <Card className="p-4 text-sm">
          <div className="font-bold text-base">
            {formatDay(r.start, { weekday: 'short', month: 'short', day: 'numeric' })} – {formatDay(r.end, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          <div className="text-gray-600">Report ID: {r.status === 'provisional' ? 'Provisional (not saved)' : r.id}</div>
          <div className="text-gray-500">
            {r.status === 'provisional' ? 'Generated' : 'Finalized'} {formatNy(r.createdAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} · {r.generatedBy === 'auto' ? 'automatically' : 'by you'}
          </div>
          {r.revision > 0 && (
            <div className="mt-1">
              <Badge tone="amber">Revision {r.revision}</Badge> replaces {r.supersedes}. Reason: {r.revisionReason}
            </div>
          )}
          <div className="text-gray-500 mt-1">
            Rep: {r.rep.name} {r.rep.phone && `· ${r.rep.phone}`}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <table className="w-full text-sm" data-testid="report-summary">
            <tbody>
              {(
                [
                  ['New Stores Added', String(d.newStores.length)],
                  ['Total Active Stores', String(d.activeStores)],
                  ['Total Orders Received', String(d.ordersCount)],
                  ['Stores That Placed Orders', String(d.distinctStores)],
                  ['Stores Without Orders', firstWeek ? 'Not Applicable — First Week' : String(d.nonOrdering!.length)],
                  ['Total Cases Ordered', String(d.totalCases)],
                  ['Total Weekly Sales', formatCents(d.salesCents)],
                  ['Commission Rate', `${d.commissionRateBps / 100}%`],
                  ['My Weekly Commission', formatCents(d.commissionCents)],
                ] as const
              ).map(([k, v], i) => (
                <tr key={k} className={`border-t border-gray-100 ${i === 8 ? 'bg-brand-light font-bold' : ''}`}>
                  <td className="p-2.5">{k}</td>
                  <td className="p-2.5 text-right tabular-nums font-semibold" data-testid={`metric-${k.replace(/\W+/g, '-').toLowerCase()}`}>
                    {v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Section title={`A. New Stores Added This Week (${d.newStores.length})`}>
          {d.newStores.length ? (
            <SimpleTable head={['#', 'Store', 'Location', 'Added']} rows={d.newStores.map((s, i) => [i + 1, s.name, s.location, formatNy(s.addedAt, { month: 'short', day: 'numeric' })])} />
          ) : (
            <p className="p-3 text-sm text-gray-600">No New Stores Added This Week.</p>
          )}
        </Section>

        <Section title={`B. Orders Received — ${d.ordersCount} orders, ${d.distinctStores} stores`}>
          {d.storesWithOrders.length ? (
            <SimpleTable
              head={['#', 'Store', 'Location', 'Orders', 'Sales']}
              rows={d.storesWithOrders.map((s, i) => [i + 1, s.name, s.location, s.orders, formatCents(s.valueCents) + (s.pendingOrders ? ` (+${s.pendingOrders} pending)` : '')])}
              rightCols={[3, 4]}
            />
          ) : (
            <p className="p-3 text-sm text-gray-600">No orders were finalized this week.</p>
          )}
          {d.flaggedOrders.length > 0 && (
            <p className="p-3 text-xs text-amber-800 border-t border-gray-100">
              Flagged (not in confirmed sales until prices are added): {d.flaggedOrders.map((f) => `#${f.orderNo} ${f.storeName}`).join('; ')}
            </p>
          )}
        </Section>

        <Section title="C. Total Weekly Sales">
          <div className="grid grid-cols-2 gap-2 p-3 text-sm">
            <div>Orders received: <b>{d.ordersCount}</b></div>
            <div>Stores that ordered: <b>{d.distinctStores}</b></div>
            <div>Cases ordered: <b>{d.totalCases}</b></div>
            <div>
              Sales: <b>{formatCents(d.salesCents)}</b>
            </div>
          </div>
        </Section>

        <Section title="D. Stores That Did Not Place Orders">
          {firstWeek ? (
            <p className="p-3 text-sm text-gray-600">Not Applicable — First Week. This starts from Week 2.</p>
          ) : (
            <>
              <p className="p-3 text-sm">
                Active stores: <b>{d.activeStores}</b> · Ordered: <b>{d.distinctStores}</b> · Did not order: <b data-testid="non-ordering-count">{d.nonOrdering!.length}</b>
              </p>
              {d.nonOrdering!.length > 0 && (
                <SimpleTable head={['#', 'Store', 'Location', 'Last order']} rows={d.nonOrdering!.map((s, i) => [i + 1, s.name, s.location, s.lastOrderAt ? formatNy(s.lastOrderAt, { month: 'short', day: 'numeric' }) : 'No Previous Order'])} />
              )}
              <p className="px-3 pb-3 text-xs text-gray-500">Active = registered by the end of the week and not archived. Stores archived before or during the week are not listed.</p>
            </>
          )}
        </Section>

        <Card className="p-4 bg-brand-light border-brand/30">
          <div className="text-sm text-gray-700">Total Weekly Sales: <b>{formatCents(d.salesCents)}</b></div>
          <div className="text-sm text-gray-700">Commission Rate: <b>1%</b></div>
          <div className="text-xl font-bold text-brand mt-1" data-testid="commission">
            My Weekly Commission: {formatCents(d.commissionCents)}
          </div>
        </Card>

        <div className="flex gap-2">
          <button type="button" className={`${btnPrimary} flex-1`} disabled={busy} onClick={() => pdf('download')}>
            <Icon name="download" /> Download Weekly Report PDF
          </button>
          {canShareFiles() && (
            <button type="button" aria-label="Share weekly report PDF" className={`${btnPrimary} w-14 px-0`} disabled={busy} onClick={() => pdf('share')}>
              <Icon name="share" />
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 px-1">Private report for you — it is never sent to the distributor.</p>

        {r.status === 'final' && (
          <button
            type="button"
            className={`${btnSecondary} w-full`}
            onClick={async () => {
              const reason = await promptDialog('Create a revised report?', '', { message: 'The current version is kept unchanged and marked as replaced. Reason for the revision:', okText: 'Create revision' });
              if (reason == null) return;
              try {
                const rev = await createRevision(r.periodKey, reason || 'Correction');
                toast(`Revised report ${rev.id} created`);
                location.hash = `#/reports/${rev.id}`;
              } catch (e) {
                toast((e as Error).message, 'err');
              }
            }}
          >
            Create revised report
          </button>
        )}
        {history.length > 1 && (
          <Card className="p-3 text-sm">
            <div className="font-semibold mb-1">Audit trail</div>
            <ul className="space-y-1">
              {history.map((h) => (
                <li key={h.id}>
                  <a className="text-brand underline" href={`#/reports/${h.id}`}>
                    {h.id}
                  </a>{' '}
                  — {formatNy(h.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {h.status === 'superseded' ? 'replaced' : 'current'} · {formatCents(h.data.salesCents)}
                  {h.revisionReason ? ` · ${h.revisionReason}` : ''}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-3 py-2 font-semibold bg-gray-50 border-b border-gray-200 text-sm">{title}</div>
      {children}
    </Card>
  );
}
function SimpleTable({ head, rows, rightCols = [] }: { head: string[]; rows: (string | number)[][]; rightCols?: number[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-gray-500">
        <tr>
          {head.map((h, i) => (
            <th key={h} className={`p-2 ${rightCols.includes(i) ? 'text-right' : 'text-left'}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-gray-100 align-top">
            {r.map((c, j) => (
              <td key={j} className={`p-2 ${rightCols.includes(j) ? 'text-right tabular-nums' : ''}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

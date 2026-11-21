import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AppDB, useDb, db } from '../src/db/db';
import * as S from '../src/state/store';
import { BUNDLED_DATASETS } from '../src/data/bundled';
import { ensureWeeklyReports, createRevision, listLatestReports, provisionalReport, reportHistory, changedSince } from '../src/db/reports';
import { weekOf, weekFromKey, nyMidnightUtc, closedWeeks } from '../src/lib/week';
import { computeWeeklyReport, commissionCents, orderValue } from '../src/lib/reports';
import { displayName } from '../src/lib/products';
import type { Order, Store } from '../src/types';

BUNDLED_DATASETS.splice(1); // price sheet only: faster, and these tests are about orders and stores

/** "2026-11-21 13:05" New York local time → epoch ms */
function ny(dateTime: string): number {
  const [d, t = '00:00:00'] = dateTime.split(' ');
  const [hh, mm, ss = '0'] = t.split(':');
  return nyMidnightUtc(d) + ((+hh * 60 + +mm) * 60 + +ss) * 1000;
}
afterEach(() => vi.useRealTimers());
const at = (dateTime: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ny(dateTime));
};

describe('reporting weeks (Sat–Fri, America/New_York)', () => {
  it('matches the owner’s schedule and boundaries', () => {
    expect(weekOf(ny('2026-11-21 00:00:00'))).toMatchObject({ number: 1, start: '2026-11-21', end: '2026-11-27' });
    expect(weekOf(ny('2026-11-27 23:59:59'))).toMatchObject({ number: 1 });
    expect(weekOf(ny('2026-11-28 00:00:00'))).toMatchObject({ number: 2, start: '2026-11-28', end: '2026-12-04' });
    expect(weekOf(ny('2026-12-09 10:00'))).toMatchObject({ number: 3, start: '2026-12-05', end: '2026-12-11' });
    // an instant belongs to exactly one week: [startUtc, endUtc)
    const w1 = weekFromKey('2026-11-21');
    expect(w1.endUtc).toBe(weekFromKey('2026-11-28').startUtc);
    expect(w1.endUtc - w1.startUtc).toBe(7 * 86400000);
    expect(new Date(w1.startUtc).toISOString()).toBe('2026-11-21T05:00:00.000Z'); // EST = UTC-5
  });
  it('handles daylight-saving changes', () => {
    const spring = weekOf(ny('2027-03-14 12:00')); // DST starts Sun Mar 14, 2027
    expect(spring).toMatchObject({ start: '2027-03-13', end: '2027-03-19' });
    expect(spring.endUtc - spring.startUtc).toBe(7 * 86400000 - 3600000);
    const fall = weekOf(ny('2027-11-07 12:00')); // DST ends Sun Nov 7, 2027
    expect(fall.endUtc - fall.startUtc).toBe(7 * 86400000 + 3600000);
  });
  it('lists closed weeks only after Friday 11:59:59 PM', () => {
    expect(closedWeeks(ny('2026-11-27 23:59:59'))).toHaveLength(0);
    expect(closedWeeks(ny('2026-11-28 00:00:00')).map((w) => w.key)).toEqual(['2026-11-21']);
  });
});

describe('commission', () => {
  it('is exactly 1% with standard rounding to the cent', () => {
    expect(commissionCents(850000)).toBe(8500); // $8,500 → $85.00
    expect(commissionCents(1275000)).toBe(12750); // $12,750 → $127.50
    expect(commissionCents(12350)).toBe(124); // $123.50 → $1.235 → $1.24
    expect(commissionCents(12349)).toBe(123);
    expect(commissionCents(0)).toBe(0);
  });
});

/* ----------------------------- pure report calculation ----------------------------- */

const store = (id: string, name: string, created: string, extra: Partial<Store> = {}): Store => ({
  id, name, address: `${name} St, FL`, phone: '', manager: '', archived: false, createdAt: ny(created), updatedAt: ny(created), ...extra,
});
let seq = 0;
const order = (storeId: string, when: string, lines: [number | null, number][], extra: Partial<Order> = {}): Order => ({
  id: `o${++seq}`, orderNo: `N${seq}`, storeId, store: { name: storeId, address: '', phone: '', manager: '' }, rep: { name: 'V', phone: '' },
  company: { companyName: '', companyAddress: '', companyPhone: '' },
  lines: lines.map(([price, qty], i) => ({ productId: `p${i}`, name: `P${i}`, unitsPerCase: null, priceCents: price, qty, note: '', lineTotalCents: price == null ? null : price * qty })),
  totals: { products: lines.length, cases: lines.reduce((s, l) => s + l[1], 0), valueCents: 0, unpricedLines: 0, unpricedCases: 0 },
  createdAt: ny(when), ...extra,
});

describe('weekly report calculation', () => {
  const stores = [
    store('abc', 'ABC Convenience', '2026-11-10', {}), // existing customer, not new
    store('xyz', 'XYZ Market', '2026-11-23 09:00', { isNew: true }), // new in week 1
    store('def', 'DEF Store', '2026-11-29 10:00', { isNew: true }), // new in week 2, never orders
    store('old', 'Old Shop', '2026-11-01', { archived: true, archivedAt: ny('2026-11-20') }), // archived before week 1
    store('arc', 'Archived Mid', '2026-11-01', { archived: true, archivedAt: ny('2026-12-01 12:00') }), // archived during week 2
    store('quiet', 'Quiet Corner', '2026-11-05'), // ordered in week 1 only
    store('existing-unmarked', 'Added But Not New', '2026-11-24'), // created in week 1 without the mark
  ];
  const orders = [
    // week 1
    order('abc', '2026-11-21 10:00', [[20000, 1]]),
    order('abc', '2026-11-24 10:00', [[35000, 1]]),
    order('abc', '2026-11-27 23:59:59', [[15000, 1]]), // last second of week 1
    order('quiet', '2026-11-22 11:00', [[1250, 3]]),
    order('xyz', '2026-11-25 12:00', [[1000, 2], [null, 1]]), // missing a price → flagged
    // week 2
    order('abc', '2026-11-28 00:00:00', [[5000, 2]]), // first second of week 2
    order('xyz', '2026-12-02 08:00', [[999, 3]]),
  ];

  it('week 1: combines a store’s orders, counts distinct stores once, flags missing prices, no non-ordering list', () => {
    const r = computeWeeklyReport({ week: weekFromKey('2026-11-21'), stores, orders, adjustments: [] });
    const abc = r.storesWithOrders.find((s) => s.storeId === 'abc')!;
    expect(abc).toMatchObject({ orders: 3, valueCents: 70000 }); // $200 + $350 + $150 = $700
    expect(r.ordersCount).toBe(5);
    expect(r.distinctStores).toBe(3);
    expect(r.salesCents).toBe(70000 + 3750); // flagged XYZ order excluded, not counted as $0 sales
    expect(r.flaggedOrders.map((f) => f.storeName)).toEqual(['XYZ Market']);
    expect(r.storesWithOrders.find((s) => s.storeId === 'xyz')).toMatchObject({ orders: 1, pendingOrders: 1, valueCents: 0 });
    expect(r.totalCases).toBe(1 + 1 + 1 + 3 + 3);
    expect(r.newStores.map((s) => s.name)).toEqual(['XYZ Market']); // only stores marked new
    expect(r.nonOrdering).toBeNull(); // first week: not applicable
    expect(r.commissionCents).toBe(commissionCents(73750));
  });

  it('week 2: lists active stores without orders, includes new never-ordered stores, excludes archived ones', () => {
    const r = computeWeeklyReport({ week: weekFromKey('2026-11-28'), stores, orders, adjustments: [] });
    expect(r.ordersCount).toBe(2);
    expect(r.salesCents).toBe(10000 + 2997);
    expect(r.newStores.map((s) => s.name)).toEqual(['DEF Store']);
    const non = r.nonOrdering!;
    expect(non.map((s) => s.name).sort()).toEqual(['Added But Not New', 'DEF Store', 'Quiet Corner']);
    expect(non.find((s) => s.name === 'DEF Store')!.lastOrderAt).toBeNull(); // never ordered
    expect(non.find((s) => s.name === 'Quiet Corner')!.lastOrderAt).toBe(ny('2026-11-22 11:00')); // ordered before
    expect(non.some((s) => s.storeId === 'abc' || s.storeId === 'xyz')).toBe(false); // they ordered
    expect(non.some((s) => s.storeId === 'old' || s.storeId === 'arc')).toBe(false); // archived before / during
    expect(r.activeStores).toBe(5); // abc, xyz, def, quiet, existing-unmarked
  });

  it('every order is counted in exactly one week; voided orders and adjustments are applied', () => {
    const w1 = computeWeeklyReport({ week: weekFromKey('2026-11-21'), stores, orders, adjustments: [] });
    const w2 = computeWeeklyReport({ week: weekFromKey('2026-11-28'), stores, orders, adjustments: [] });
    const ids = [...w1.orders, ...w2.orders].map((o) => o.orderId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(orders.length);
    const flaggedId = orders[4].id;
    const voidId = orders[0].id;
    const adjusted = computeWeeklyReport({
      week: weekFromKey('2026-11-21'), stores, orders,
      adjustments: [
        { id: 'a1', orderId: voidId, kind: 'void', reason: 'cancelled', at: ny('2026-11-26') },
        { id: 'a2', orderId: flaggedId, kind: 'price', lineIndex: 1, priceCents: 500, reason: 'resolved', at: ny('2026-11-26') },
      ],
    });
    expect(adjusted.ordersCount).toBe(4);
    expect(adjusted.salesCents).toBe(50000 + 3750 + 2500);
    expect(adjusted.flaggedOrders).toEqual([]);
    expect(orderValue(orders[4], [{ id: 'a2', orderId: flaggedId, kind: 'price', lineIndex: 1, priceCents: 500, reason: '', at: 0 }]).valueCents).toBe(2500);
  });
});

/* ----------------------------- app + database ----------------------------- */

let dbn = 0;
async function fresh() {
  useDb(new AppDB(`reports-${++dbn}`));
  await S.init();
}
const prod = (name: string) => S.getState().products.find((p) => displayName(p) === name)!;
async function placeOrder(storeId: string, when: string, product: string, qty: number) {
  at(when);
  await S.selectStore(storeId);
  S.setQty(prod(product).id, qty);
  return S.finalizeOrder(storeId);
}

describe('NEW STORE — FIRST ORDER', () => {
  it('appears only on a new store’s first finalized order; independent per store; never on existing stores', async () => {
    await fresh();
    const existing = await S.saveStore({ name: 'Existing Store', address: '1 Old Rd' }); // not marked
    const a = await S.saveStore({ name: 'New A', address: '1 A St', isNew: true });
    expect(a.isNew).toBe(true);
    expect(S.isFirstOrderPending(a.id)).toBe(true);
    // drafts and PDF previews don't use it up
    await S.selectStore(a.id);
    S.setQty(prod('CELSIUS 12OZ / 12CT').id, 2);
    await S.flushDrafts();
    expect(S.isFirstOrderPending(a.id)).toBe(true);
    const o1 = await S.finalizeOrder(a.id);
    expect(o1.newStoreFirstOrder).toBe(true);
    expect(S.isFirstOrderPending(a.id)).toBe(false);
    // adding another new store does not reset store A
    const b = await S.saveStore({ name: 'New B', address: '2 B St', isNew: true });
    S.setQty(prod('CELSIUS 12OZ / 12CT').id, 1);
    const o2 = await S.finalizeOrder(a.id);
    expect(o2.newStoreFirstOrder).toBeFalsy();
    expect(S.isFirstOrderPending(b.id)).toBe(true);
    await S.selectStore(b.id);
    S.setQty(prod('BANG 16OZ / 12CT').id, 1);
    expect((await S.finalizeOrder(b.id)).newStoreFirstOrder).toBe(true);
    await S.selectStore(existing.id);
    S.setQty(prod('BANG 16OZ / 12CT').id, 1);
    expect((await S.finalizeOrder(existing.id)).newStoreFirstOrder).toBeFalsy();
    // editing can't mark an existing store as new
    const edited = await S.saveStore({ ...existing, isNew: true });
    expect(edited.isNew).toBe(false);
    // persists after reload; the historical order keeps its label
    await S.reload();
    expect(S.getState().stores.find((s) => s.id === a.id)!.firstOrderId).toBe(o1.id);
    expect((await S.getOrder(o1.id))!.newStoreFirstOrder).toBe(true);
    expect((await S.getOrder(o2.id))!.newStoreFirstOrder).toBeFalsy();
    // ... and survives backup + restore (e.g. a new phone)
    const backup = JSON.parse(JSON.stringify(await S.makeBackup()));
    await fresh();
    await S.restoreFromBackup(backup);
    expect(S.isFirstOrderPending(a.id)).toBe(false);
    expect(S.isFirstOrderPending(b.id)).toBe(false);
    expect((await S.getOrder(o1.id))!.newStoreFirstOrder).toBe(true);
  });
});

describe('finalized weekly reports', () => {
  it('are created once per closed week (even when triggered many times at once) and never change afterwards', async () => {
    at('2026-11-21 08:00');
    await fresh();
    const abc = await S.saveStore({ name: 'ABC Convenience', address: 'Deerfield Beach, FL' });
    at('2026-11-23 09:00');
    const xyz = await S.saveStore({ name: 'XYZ Market', address: 'Pompano Beach, FL', isNew: true });
    await placeOrder(abc.id, '2026-11-24 10:00', 'GATORADE 20OZ / 24CT', 10); // $239.90
    await placeOrder(abc.id, '2026-11-26 10:00', 'GATORADE 20OZ / 24CT', 5); // $119.95
    await placeOrder(xyz.id, '2026-11-27 23:59:59', 'MONSTER 16OZ / 24CT', 2); // $77.00 — last second of week 1

    // week still open → nothing finalized, only a provisional report
    at('2026-11-27 23:59:59');
    expect(await ensureWeeklyReports()).toEqual([]);
    const prov = (await provisionalReport())!;
    expect(prov.status).toBe('provisional');
    expect(prov.data.salesCents).toBe(23990 + 11995 + 7700);
    expect(await db.reports.count()).toBe(0); // provisional is never saved

    // Friday 11:59:59 PM has passed → week 1 is finalized; simultaneous triggers create ONE report
    at('2026-11-28 00:00:05');
    const results = await Promise.all([ensureWeeklyReports(), ensureWeeklyReports(), ensureWeeklyReports()]);
    expect(results.flat()).toEqual(['WR-2026-11-21']);
    expect(await db.reports.count()).toBe(1);
    const w1 = (await db.reports.get('WR-2026-11-21'))!;
    expect(w1).toMatchObject({ weekNumber: 1, start: '2026-11-21', end: '2026-11-27', status: 'final', generatedBy: 'auto' });
    expect(w1.data.ordersCount).toBe(3);
    expect(w1.data.distinctStores).toBe(2);
    expect(w1.data.storesWithOrders.find((s) => s.name === 'ABC Convenience')).toMatchObject({ orders: 2, valueCents: 35985 });
    expect(w1.data.salesCents).toBe(43685);
    expect(w1.data.commissionCents).toBe(437); // $436.85 × 1% = $4.3685 → $4.37
    expect(w1.data.newStores.map((s) => s.name)).toEqual(['XYZ Market']);
    expect(w1.data.nonOrdering).toBeNull();
    expect(w1.rep.phone).toBe(''); // price-sheet-only test setup (the real app fills +1 561-552-6556)

    // week 2: later changes (price update, new orders, renamed store) never touch week 1
    await S.setPriceItemPrice(prod('GATORADE 20OZ / 24CT').priceItemId!, 9999);
    await placeOrder(xyz.id, '2026-11-30 10:00', 'GATORADE 20OZ / 24CT', 1); // $99.99 at the new price
    at('2026-12-01 09:00');
    await S.saveStore({ ...S.getState().stores.find((s) => s.id === abc.id)!, name: 'ABC Renamed' });
    at('2026-12-05 00:00:01');
    expect(await ensureWeeklyReports()).toEqual(['WR-2026-11-28']);
    expect(await ensureWeeklyReports()).toEqual([]); // idempotent
    const w1again = (await db.reports.get('WR-2026-11-21'))!;
    expect(w1again).toEqual(w1); // byte-for-byte unchanged
    const w2 = (await db.reports.get('WR-2026-11-28'))!;
    expect(w2.data.salesCents).toBe(9999);
    expect(w2.data.ordersCount).toBe(1);
    expect(w2.data.nonOrdering!.map((s) => s.name)).toEqual(['ABC Renamed']); // ordered last week, not this week
    expect(w2.data.nonOrdering![0].lastOrderAt).toBe(ny('2026-11-26 10:00'));
    expect((await listLatestReports()).map((r) => r.id)).toEqual(['WR-2026-11-28', 'WR-2026-11-21']);

    // a correction (void) after finalizing: the report is NOT silently changed; a revision keeps the original
    const w1order = (await S.listOrders()).find((o) => o.createdAt === ny('2026-11-24 10:00'))!;
    await S.voidOrder(w1order.id, 'Store cancelled');
    expect(await changedSince(w1)).toBe(true);
    expect((await db.reports.get('WR-2026-11-21'))!.data.salesCents).toBe(43685);
    const rev = await createRevision('2026-11-21', 'Order cancelled by store');
    expect(rev).toMatchObject({ id: 'WR-2026-11-21-R1', revision: 1, supersedes: 'WR-2026-11-21', status: 'final' });
    expect(rev.data.salesCents).toBe(43685 - 23990);
    const hist = await reportHistory('2026-11-21');
    expect(hist.map((h) => [h.id, h.status])).toEqual([
      ['WR-2026-11-21', 'superseded'],
      ['WR-2026-11-21-R1', 'final'],
    ]);
    expect(hist[0].data).toEqual(w1.data); // original numbers preserved for the audit trail
    expect((await db.reports.get('WR-2026-11-28'))!.data).toEqual(w2.data); // other weeks untouched
  });
});

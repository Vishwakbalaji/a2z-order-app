/**
 * Weekly sales & commission report — pure calculation (no database), so it is easy to test.
 *
 * Rules
 *  - An order belongs to the week in which it was FINALIZED (America/New_York, Sat–Fri).
 *  - Only finalized orders count (drafts are never orders). Voided orders are excluded.
 *  - An order with any line still missing a price is flagged and left out of confirmed sales
 *    (it still counts as an order received, with its cases) until the price is resolved.
 *  - New stores = stores created with "Mark as New Store" whose Date Added falls in the week.
 *  - Non-ordering stores (from week 2): stores active at the END of the week that placed no
 *    order in it. Stores archived before or during the week are not active and are not listed;
 *    stores added during the week are included.
 *  - Commission = 1% of confirmed sales, rounded to the cent (half-up).
 *  - All money in integer cents.
 */
import type { Order, OrderAdjustment, Store, WeeklyReportData } from '../types';
import type { Week } from './week';

export const COMMISSION_RATE_BPS = 100; // 1%

export interface OrderValue {
  valueCents: number | null; // null = at least one line still has no price
  unpricedLines: number;
  cases: number;
  voided: boolean;
}

/** An order's value after adjustments recorded up to `asOf` (the order snapshot itself never changes). */
export function orderValue(order: Order, adjustments: OrderAdjustment[], asOf = Infinity): OrderValue {
  const adj = adjustments.filter((a) => a.orderId === order.id && a.at <= asOf);
  const voided = adj.some((a) => a.kind === 'void');
  const priceFix = new Map<number, number>();
  for (const a of adj.filter((x) => x.kind === 'price' && x.lineIndex != null && x.priceCents != null).sort((x, y) => x.at - y.at)) priceFix.set(a.lineIndex!, a.priceCents!);
  let total = 0;
  let unpriced = 0;
  let cases = 0;
  order.lines.forEach((l, i) => {
    if (!(l.qty > 0)) return;
    cases += l.qty;
    const price = l.priceCents ?? priceFix.get(i) ?? null;
    if (price == null) unpriced++;
    else total += price * l.qty;
  });
  return { valueCents: unpriced ? null : total, unpricedLines: unpriced, cases, voided };
}

export function commissionCents(salesCents: number, rateBps = COMMISSION_RATE_BPS): number {
  // integer math: cents × bps / 10000, rounded half-up
  return Math.floor((salesCents * rateBps + 5000) / 10000);
}

const location = (s: { address: string }) => s.address;

export function computeWeeklyReport(input: { week: Week; stores: Store[]; orders: Order[]; adjustments: OrderAdjustment[]; asOf?: number }): WeeklyReportData {
  const { week, stores, orders, adjustments } = input;
  const asOf = input.asOf ?? Infinity;
  const inWeek = (t: number) => t >= week.startUtc && t < week.endUtc;
  const storeById = new Map(stores.map((s) => [s.id, s]));

  // A. new stores acquired
  const newStores = stores
    .filter((s) => s.isNew && inWeek(s.createdAt))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((s) => ({ storeId: s.id, name: s.name, location: location(s), addedAt: s.createdAt }));

  // B/C. orders received (finalized in the week, not voided)
  const weekOrders = orders.filter((o) => inWeek(o.createdAt)).sort((a, b) => a.createdAt - b.createdAt);
  const rows: WeeklyReportData['orders'] = [];
  const flagged: WeeklyReportData['flaggedOrders'] = [];
  const perStore = new Map<string, WeeklyReportData['storesWithOrders'][number]>();
  let salesCents = 0;
  let totalCases = 0;
  for (const o of weekOrders) {
    const v = orderValue(o, adjustments, asOf);
    if (v.voided) continue;
    const st = storeById.get(o.storeId);
    const name = st?.name ?? o.store.name;
    rows.push({ orderId: o.id, orderNo: o.orderNo, storeId: o.storeId, storeName: name, at: o.createdAt, cases: v.cases, valueCents: v.valueCents });
    totalCases += v.cases;
    const row = perStore.get(o.storeId) ?? { storeId: o.storeId, name, location: st ? location(st) : o.store.address, orders: 0, cases: 0, valueCents: 0, pendingOrders: 0 };
    row.orders += 1;
    row.cases += v.cases;
    if (v.valueCents == null) {
      row.pendingOrders += 1;
      flagged.push({ orderId: o.id, orderNo: o.orderNo, storeName: name, unpricedLines: v.unpricedLines });
    } else {
      row.valueCents += v.valueCents;
      salesCents += v.valueCents;
    }
    perStore.set(o.storeId, row);
  }
  const storesWithOrders = [...perStore.values()].sort((a, b) => b.valueCents - a.valueCents || a.name.localeCompare(b.name));

  // D. active stores at the end of the week, and those that did not order (week 2 onward)
  const archivedBy = (s: Store, t: number) => s.archived && (s.archivedAt ?? s.updatedAt) < t;
  const active = stores.filter((s) => s.createdAt < week.endUtc && !archivedBy(s, week.endUtc));
  let nonOrdering: WeeklyReportData['nonOrdering'] = null;
  if (week.number >= 2) {
    const ordered = new Set(rows.map((r) => r.storeId));
    nonOrdering = active
      .filter((s) => !ordered.has(s.id))
      .map((s) => {
        const last = orders
          .filter((o) => o.storeId === s.id && o.createdAt < week.endUtc && !orderValue(o, adjustments, asOf).voided)
          .reduce((m, o) => Math.max(m, o.createdAt), 0);
        return { storeId: s.id, name: s.name, location: location(s), lastOrderAt: last || null };
      })
      .sort((a, b) => (a.lastOrderAt ?? 0) - (b.lastOrderAt ?? 0) || a.name.localeCompare(b.name));
  }

  return {
    newStores,
    storesWithOrders,
    orders: rows,
    flaggedOrders: flagged,
    ordersCount: rows.length,
    distinctStores: perStore.size,
    totalCases,
    salesCents,
    activeStores: active.length,
    nonOrdering,
    commissionRateBps: COMMISSION_RATE_BPS,
    commissionCents: commissionCents(salesCents),
  };
}

/** True if the numbers of a finalized report differ from a fresh calculation (e.g. an order was voided later). */
export function reportChanged(a: WeeklyReportData, b: WeeklyReportData): boolean {
  const sig = (d: WeeklyReportData) =>
    JSON.stringify([d.ordersCount, d.distinctStores, d.totalCases, d.salesCents, d.newStores.map((s) => s.storeId), d.orders.map((o) => [o.orderId, o.valueCents]), d.flaggedOrders.length, d.nonOrdering?.map((s) => s.storeId) ?? null]);
  return sig(a) !== sig(b);
}

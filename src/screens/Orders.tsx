import { useEffect, useState } from 'react';
import { Badge, Card, Empty, PageHeader, btnDanger, btnSecondary, confirmDialog, promptDialog, toast, Icon } from '../components/ui';
import { PdfActions } from '../components/PdfActions';
import { listOrders, getOrder, copyOrderToDraft, useApp, getState, listAdjustments, voidOrder, resolveOrderPrice } from '../state/store';
import { formatCents, parseMoneyToCents } from '../lib/money';
import { orderValue } from '../lib/reports';
import { go } from '../lib/router';
import type { Order, OrderAdjustment } from '../types';

const fmtDate = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "Order History | Weekly Reports" switch shown at the top of both pages. */
export function OrdersTabs({ active }: { active: 'orders' | 'reports' }) {
  return (
    <div className="flex gap-2 px-3 pt-3" role="tablist">
      {(
        [
          ['orders', 'Order History', '#/orders'],
          ['reports', 'Weekly Reports', '#/reports'],
        ] as const
      ).map(([k, label, href]) => (
        <a key={k} href={href} role="tab" aria-selected={active === k} className={`flex-1 h-10 rounded-full text-sm font-semibold border flex items-center justify-center ${active === k ? 'bg-brand text-white border-brand' : 'bg-white border-gray-300 text-gray-700'}`}>
          {label}
        </a>
      ))}
    </div>
  );
}

export function OrdersScreen() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [adj, setAdj] = useState<OrderAdjustment[]>([]);
  const [q, setQ] = useState('');
  const version = useApp((s) => s.reportsVersion);
  useEffect(() => {
    listOrders().then(setOrders);
    listAdjustments().then(setAdj);
  }, [version]);
  const ql = q.trim().toLowerCase();
  const list = (orders || []).filter((o) => !ql || `${o.store.name} ${o.orderNo}`.toLowerCase().includes(ql));
  return (
    <div>
      <PageHeader title="Orders" />
      <OrdersTabs active="orders" />
      <div className="p-3">
        {(orders?.length || 0) > 4 && (
          <input type="search" placeholder="Search by store or order no." value={q} onChange={(e) => setQ(e.target.value)} className="w-full h-11 px-3 mb-3 rounded-xl border border-gray-300 bg-white" />
        )}
        {orders && !orders.length && (
          <Empty title="No completed orders yet">
            <p>When you finalize an order in the Cart, a permanent copy is saved here.</p>
          </Empty>
        )}
        <ul className="space-y-2">
          {list.map((o) => {
            const v = orderValue(o, adj);
            return (
              <li key={o.id}>
                <a href={`#/orders/${o.id}`} className="block">
                  <Card className={`p-3 active:bg-gray-50 ${v.voided ? 'opacity-60' : ''}`}>
                    <div className="flex justify-between gap-2">
                      <div className="font-semibold truncate">{o.store.name}</div>
                      <div className={`font-bold tabular-nums ${v.voided ? 'line-through' : ''}`}>{v.valueCents == null ? <span className="text-amber-700 text-sm">price missing</span> : formatCents(v.valueCents)}</div>
                    </div>
                    <div className="text-sm text-gray-500 flex justify-between gap-2">
                      <span>
                        {fmtDate(o.createdAt)} · #{o.orderNo}
                      </span>
                      <span>
                        {o.totals.products} prod · {o.totals.cases} cs
                      </span>
                    </div>
                    {(v.voided || o.newStoreFirstOrder) && (
                      <div className="mt-1 flex gap-1">
                        {v.voided && <Badge tone="red">VOID</Badge>}
                        {o.newStoreFirstOrder && <Badge tone="green">NEW STORE — FIRST ORDER</Badge>}
                      </div>
                    )}
                  </Card>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function OrderDetailScreen({ id }: { id: string }) {
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [adj, setAdj] = useState<OrderAdjustment[]>([]);
  const logo = useApp((s) => s.settings.logoDataUrl);
  const version = useApp((s) => s.reportsVersion);
  useEffect(() => {
    getOrder(id).then((o) => setOrder(o || null));
    listAdjustments(id).then(setAdj);
  }, [id, version]);
  if (order === undefined) return <PageHeader title="Order" back="#/orders" />;
  if (!order) return <><PageHeader title="Order" back="#/orders" /><Empty title="Order not found" /></>;
  const o = order;
  const v = orderValue(o, adj);
  const fixed = new Map(adj.filter((a) => a.kind === 'price').map((a) => [a.lineIndex!, a.priceCents!]));
  const reload = async () => {
    setAdj(await listAdjustments(id));
  };
  return (
    <div>
      <PageHeader title={`Order #${o.orderNo}`} back="#/orders" />
      <div className="p-3 space-y-3">
        {v.voided && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-800 text-sm" role="alert">
            <b>VOID.</b> This order is cancelled and is not counted in weekly sales. Reason: {adj.find((a) => a.kind === 'void')?.reason}
          </div>
        )}
        <Card className="p-4 text-[15px]">
          <div className="font-bold text-lg">{o.store.name}</div>
          <div className="text-gray-600">{o.store.address}</div>
          {(o.store.phone || o.store.manager) && <div className="text-gray-600">{[o.store.manager, o.store.phone].filter(Boolean).join(' · ')}</div>}
          {o.newStoreFirstOrder && (
            <div className="mt-2">
              <Badge tone="green">NEW STORE — FIRST ORDER</Badge>
            </div>
          )}
          <div className="text-gray-500 text-sm mt-2">
            {fmtDate(o.createdAt)} · Rep: {o.rep.name}
            {o.rep.phone ? ` (${o.rep.phone})` : ''}
          </div>
          <div className="text-xs text-gray-400 mt-1">Completed orders are permanent snapshots — prices shown are the prices at the time of the order.</div>
        </Card>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left p-2 w-8">#</th>
                <th className="text-left p-2">Product</th>
                <th className="text-right p-2">Price</th>
                <th className="text-right p-2">Cs</th>
                <th className="text-right p-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l, i) => {
                const price = l.priceCents ?? fixed.get(i) ?? null;
                return (
                  <tr key={i} className="border-t border-gray-100 align-top">
                    <td className="p-2 text-gray-500">{i + 1}</td>
                    <td className="p-2">
                      {l.name}
                      {l.note && <div className="text-xs text-gray-500">Note: {l.note}</div>}
                      {l.priceCents == null && fixed.has(i) && <div className="text-xs text-green-700">Price added after finalizing</div>}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {price == null ? (
                        <button
                          type="button"
                          className="text-amber-700 underline font-semibold"
                          onClick={async () => {
                            const val = await promptDialog('Case price', '', { inputMode: 'decimal', message: `${l.name} — the price was not available when this order was finalized.`, okText: 'Save price' });
                            if (val == null) return;
                            const c = parseMoneyToCents(val);
                            if (c == null) return toast('Not a valid price', 'err');
                            try {
                              await resolveOrderPrice(o.id, i, c);
                              toast('Price recorded');
                              reload();
                            } catch (e) {
                              toast((e as Error).message, 'err');
                            }
                          }}
                        >
                          N/A — add
                        </button>
                      ) : (
                        formatCents(price)
                      )}
                    </td>
                    <td className="p-2 text-right font-semibold tabular-nums">{l.qty}</td>
                    <td className="p-2 text-right tabular-nums">{price == null ? '—' : formatCents(price * l.qty)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="grid grid-cols-3 text-center border-t border-gray-200 p-3 bg-gray-50">
            <div>
              <div className="text-xs text-gray-500">Products</div>
              <div className="font-bold text-lg">{o.totals.products}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Cases</div>
              <div className="font-bold text-lg">{o.totals.cases}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Value</div>
              <div className="font-bold text-lg text-brand">{v.valueCents == null ? formatCents(o.totals.valueCents) : formatCents(v.valueCents)}</div>
            </div>
          </div>
          {v.unpricedLines > 0 && <p className="text-xs text-amber-800 px-3 pb-3 bg-gray-50">{v.unpricedLines} product(s) have no price. This order is flagged in weekly reports and left out of confirmed sales until the price is added (tap "N/A — add").</p>}
        </Card>
        <PdfActions
          getOrder={() => ({
            company: o.company,
            logoDataUrl: logo,
            store: o.store,
            rep: o.rep,
            date: new Date(o.createdAt),
            orderNo: o.orderNo,
            lines: o.lines.map((l) => ({ name: l.name, qty: l.qty, priceCents: l.priceCents, note: l.note })),
            totals: o.totals,
            newStoreFirstOrder: !!o.newStoreFirstOrder, // historical: kept forever on that order
          })}
        />
        <button
          type="button"
          className={`${btnSecondary} w-full`}
          onClick={async () => {
            const current = getState().drafts.get(o.storeId) || [];
            const msg = current.length
              ? `${o.store.name} already has a draft with ${current.length} products. It will be REPLACED by a copy of this order (current prices). This order itself is not changed.`
              : `Creates a new draft for ${o.store.name} with the same products and quantities, at current prices. This order itself is not changed.`;
            if (!(await confirmDialog('Copy to new draft?', msg, 'Copy'))) return;
            try {
              const { skipped } = await copyOrderToDraft(o);
              toast(skipped.length ? `Copied. ${skipped.length} discontinued product(s) skipped.` : 'Copied to a new draft');
              go('cart');
            } catch (e) {
              toast((e as Error).message, 'err');
            }
          }}
        >
          <Icon name="edit" /> Copy to new draft
        </button>
        {!v.voided && (
          <button
            type="button"
            className={`${btnDanger} w-full`}
            onClick={async () => {
              const reason = await promptDialog('Void this order?', '', {
                message: 'Use this if the order was cancelled. The order stays in history marked VOID and is no longer counted in weekly sales. Reports already finalized are not changed — you can create a revised report. Reason:',
                okText: 'Void order',
              });
              if (reason == null) return;
              try {
                await voidOrder(o.id, reason || 'Cancelled');
                toast('Order voided');
                reload();
              } catch (e) {
                toast((e as Error).message, 'err');
              }
            }}
          >
            Void order
          </button>
        )}
        {adj.length > 0 && (
          <Card className="p-3 text-sm">
            <div className="font-semibold mb-1">Changes after finalizing</div>
            <ul className="space-y-1 text-gray-600">
              {adj.map((a) => (
                <li key={a.id}>
                  {fmtDate(a.at)} — {a.kind === 'void' ? `Voided: ${a.reason}` : `Price ${formatCents(a.priceCents!)} added for line ${a.lineIndex! + 1}`}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Card, Empty, PageHeader, btnSecondary, confirmDialog, toast, Icon } from '../components/ui';
import { PdfActions } from '../components/PdfActions';
import { listOrders, getOrder, copyOrderToDraft, useApp, getState } from '../state/store';
import { formatCents } from '../lib/money';
import { go } from '../lib/router';
import type { Order } from '../types';

const fmtDate = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function OrdersScreen() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    listOrders().then(setOrders);
  }, []);
  const ql = q.trim().toLowerCase();
  const list = (orders || []).filter((o) => !ql || `${o.store.name} ${o.orderNo}`.toLowerCase().includes(ql));
  return (
    <div>
      <PageHeader title="Order History" />
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
          {list.map((o) => (
            <li key={o.id}>
              <a href={`#/orders/${o.id}`} className="block">
                <Card className="p-3 active:bg-gray-50">
                  <div className="flex justify-between gap-2">
                    <div className="font-semibold truncate">{o.store.name}</div>
                    <div className="font-bold tabular-nums">{formatCents(o.totals.valueCents)}</div>
                  </div>
                  <div className="text-sm text-gray-500 flex justify-between gap-2">
                    <span>
                      {fmtDate(o.createdAt)} · #{o.orderNo}
                    </span>
                    <span>
                      {o.totals.products} prod · {o.totals.cases} cs
                    </span>
                  </div>
                </Card>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function OrderDetailScreen({ id }: { id: string }) {
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const logo = useApp((s) => s.settings.logoDataUrl);
  useEffect(() => {
    getOrder(id).then((o) => setOrder(o || null));
  }, [id]);
  if (order === undefined) return <PageHeader title="Order" back="#/orders" />;
  if (!order) return <><PageHeader title="Order" back="#/orders" /><Empty title="Order not found" /></>;
  const o = order;
  return (
    <div>
      <PageHeader title={`Order #${o.orderNo}`} back="#/orders" />
      <div className="p-3 space-y-3">
        <Card className="p-4 text-[15px]">
          <div className="font-bold text-lg">{o.store.name}</div>
          <div className="text-gray-600">{o.store.address}</div>
          {(o.store.phone || o.store.manager) && <div className="text-gray-600">{[o.store.manager, o.store.phone].filter(Boolean).join(' · ')}</div>}
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
              {o.lines.map((l, i) => (
                <tr key={i} className="border-t border-gray-100 align-top">
                  <td className="p-2 text-gray-500">{i + 1}</td>
                  <td className="p-2">
                    {l.name}
                    {l.note && <div className="text-xs text-gray-500">Note: {l.note}</div>}
                  </td>
                  <td className="p-2 text-right tabular-nums">{l.priceCents == null ? <span className="text-amber-700">N/A</span> : formatCents(l.priceCents)}</td>
                  <td className="p-2 text-right font-semibold tabular-nums">{l.qty}</td>
                  <td className="p-2 text-right tabular-nums">{l.lineTotalCents == null ? '—' : formatCents(l.lineTotalCents)}</td>
                </tr>
              ))}
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
              <div className="font-bold text-lg text-brand">{formatCents(o.totals.valueCents)}</div>
            </div>
          </div>
          {o.totals.unpricedLines > 0 && <p className="text-xs text-amber-800 px-3 pb-3 bg-gray-50">Excludes {o.totals.unpricedLines} product(s) with no price.</p>}
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
      </div>
    </div>
  );
}

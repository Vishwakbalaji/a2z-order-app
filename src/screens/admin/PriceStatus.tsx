import { useMemo, useState } from 'react';
import { Card, Empty, PageHeader, inputCls, promptDialog, toast } from '../../components/ui';
import { PriceLabel } from '../../components/PriceLabel';
import { useApp, confirmPrice, undoPriceConfirmation, saveProduct } from '../../state/store';
import { displayName, priceInfo, sizeLabel, titleName, type PriceInfo } from '../../lib/products';
import { formatCents, parseMoneyToCents } from '../../lib/money';
import { tokens } from '../../lib/normalize';
import type { Product } from '../../types';

type Tab = 'select' | 'approximate' | 'none' | 'mine';
const PAGE = 60;

/** Prices to check: choose between two prices, confirm approximate (orange) prices, enter missing ones. */
export function PriceStatusScreen() {
  const products = useApp((s) => s.products);
  const priceItemById = useApp((s) => s.priceItemById);
  const browseIds = useApp((s) => s.browseIds);
  const subOf = useApp((s) => s.subOf);
  // same order as the product list: section → price-sheet brand heading
  const rows = useMemo(() => {
    const pos = new Map(browseIds.map((id, i) => [id, i]));
    return products
      .filter((p) => p.origin !== 'pricesheet' && p.active && !p.missingFromCatalog)
      .sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9))
      .map((p) => ({ p, info: priceInfo(p, priceItemById) }));
  }, [products, priceItemById, browseIds]);
  const counts = useMemo(() => {
    const c = { confirmed: 0, approximate: 0, review: 0, none: 0, mine: 0 };
    for (const r of rows) {
      c[r.info.status]++;
      if (r.p.priceConfirmedAt && r.p.priceOverrideCents != null) c.mine++;
    }
    return c;
  }, [rows]);
  const [tab, setTab] = useState<Tab>(() => (counts.review ? 'select' : 'approximate'));
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const inTab = (r: { p: Product; info: PriceInfo }) =>
    tab === 'select' ? r.info.status === 'review' : tab === 'approximate' ? r.info.status === 'approximate' : tab === 'none' ? r.info.status === 'none' : !!r.p.priceConfirmedAt && r.p.priceOverrideCents != null;
  const qt = tokens(q);
  const shown = rows.filter((r) => inTab(r) && (!qt.length || qt.every((w) => tokens(`${displayName(r.p)} ${r.p.catalogName} ${r.p.category}`).some((x) => x.startsWith(w)))));

  const enterPrice = async (p: Product) => {
    const v = await promptDialog('Enter the case price', '', { inputMode: 'decimal', message: displayName(p), okText: 'Save price' });
    if (v == null || !v.trim()) return;
    const cents = parseMoneyToCents(v);
    if (cents == null) return toast('Not a valid price', 'err');
    await saveProduct({ ...p, priceOverrideCents: cents, priceConfirmedAt: Date.now() });
    toast(`Price set to ${formatCents(cents)} (confirmed)`);
  };

  const tabs: [Tab, string, number][] = [
    ['select', 'Choose price', counts.review],
    ['approximate', 'Approximate', counts.approximate],
    ['none', 'Not listed', counts.none],
    ['mine', 'Confirmed by you', counts.mine],
  ];
  return (
    <div>
      <PageHeader title="Prices to check" back="#/settings" />
      <div className="p-3 space-y-3">
        <Card className="p-3 text-sm" data-testid="price-summary">
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span className="text-green-700 font-semibold">Confirmed</span>
            <b className="text-right">{counts.confirmed}</b>
            <span className="text-orange-600 font-semibold">Approximate</span>
            <b className="text-right">{counts.approximate}</b>
            <span className="text-gray-600 font-semibold">Needs review / price selection</span>
            <b className="text-right">{counts.review}</b>
            <span className="text-gray-600 font-semibold">Price Not Listed</span>
            <b className="text-right">{counts.none}</b>
          </div>
          <p className="text-xs text-gray-500 mt-1">Green = confirmed price. Orange = closest item on the price sheet — tap Confirm when you know it is right. Approximate prices are included in totals and marked in PDFs.</p>
        </Card>
        <div className="grid grid-cols-4 gap-1">
          {tabs.map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => (setTab(k), setLimit(PAGE))} className={`min-h-10 px-1 py-1 rounded-xl text-xs font-semibold border leading-tight ${tab === k ? 'bg-brand text-white border-brand' : 'bg-white border-gray-300'}`}>
              {label} ({n})
            </button>
          ))}
        </div>
        <input className={inputCls} placeholder="Search" aria-label="Search prices" value={q} onChange={(e) => (setQ(e.target.value), setLimit(PAGE))} />
        {!shown.length && <Empty title="Nothing here" />}
        <ul className="space-y-2">
          {shown.slice(0, limit).map(({ p, info }) => (
            <li key={p.id} data-testid="price-row">
              <Card className="p-3">
                <div className="text-xs text-gray-500">{[p.department, subOf.get(p.id)].filter(Boolean).join(' › ')}</div>
                <div className="font-semibold leading-snug break-words">{titleName(p)}</div>
                {sizeLabel(p) && <div className="text-sm text-gray-700">{sizeLabel(p)}</div>}
                <div className="mt-1">
                  <PriceLabel info={info} />
                </div>
                <div className="text-xs text-gray-500 mt-1 break-words">{info.source}</div>
                {p.supplement?.note && <div className="text-xs text-gray-500 break-words">{p.supplement.note}</div>}
                <div className="flex flex-wrap gap-2 mt-2">
                  {info.status === 'review' &&
                    (info.options || []).map((o) => (
                      <button key={o.label} type="button" className="h-10 px-3 rounded-xl bg-brand text-white text-sm font-semibold" onClick={async () => (await confirmPrice(p.id, o.cents), toast(`${formatCents(o.cents)} confirmed`))}>
                        {formatCents(o.cents)} · {o.label}
                      </button>
                    ))}
                  {info.status === 'review' && !info.options?.length && info.suggestion != null && (
                    <button type="button" className="h-10 px-3 rounded-xl bg-brand text-white text-sm font-semibold" onClick={async () => (await confirmPrice(p.id, info.suggestion!), toast(`${formatCents(info.suggestion!)} confirmed`))}>
                      Use suggested {formatCents(info.suggestion)}
                    </button>
                  )}
                  {info.status === 'approximate' && info.cents != null && (
                    <button type="button" className="h-10 px-3 rounded-xl bg-green-700 text-white text-sm font-semibold" onClick={async () => (await confirmPrice(p.id, info.cents!), toast('Price confirmed (green)'))}>
                      Confirm {formatCents(info.cents)}
                    </button>
                  )}
                  {tab !== 'mine' && (
                    <button type="button" className="h-10 px-3 rounded-xl border border-gray-300 text-sm font-semibold" onClick={() => enterPrice(p)}>
                      Enter price
                    </button>
                  )}
                  {tab === 'mine' && (
                    <button type="button" className="h-10 px-3 rounded-xl border border-gray-300 text-sm font-semibold" onClick={async () => (await undoPriceConfirmation(p.id), toast('Undone'))}>
                      Undo
                    </button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
        {shown.length > limit && (
          <button type="button" className="w-full h-11 rounded-xl border border-gray-300 bg-white font-semibold" onClick={() => setLimit(limit + PAGE)}>
            Show more ({shown.length - limit})
          </button>
        )}
      </div>
    </div>
  );
}

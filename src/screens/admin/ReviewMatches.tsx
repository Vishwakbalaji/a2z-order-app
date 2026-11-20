import { useState } from 'react';
import { Badge, Card, Empty, PageHeader, btnPrimary, btnSecondary, promptDialog, toast } from '../../components/ui';
import { PriceItemPicker } from '../../components/PriceItemPicker';
import { useApp, confirmMatch, leaveUnmatched, saveProduct } from '../../state/store';
import { formatCents, parseMoneyToCents } from '../../lib/money';
import { displayName } from '../../lib/products';
import { rankCandidates } from '../../lib/matching';
import type { MatchStatus, Product } from '../../types';

export function ReviewMatchesScreen() {
  const products = useApp((s) => s.products);
  const priceItemById = useApp((s) => s.priceItemById);
  const priceItems = useApp((s) => s.priceItems);
  const [tab, setTab] = useState<MatchStatus>('review');
  const [picking, setPicking] = useState<Product | null>(null);
  const list = products.filter((p) => p.origin !== 'pricesheet' && p.active);
  const by = (s: MatchStatus) => list.filter((p) => p.matchStatus === s);
  const shown = by(tab);

  const manualPrice = async (p: Product) => {
    const v = await promptDialog('Enter case price manually', p.priceOverrideCents != null ? (p.priceOverrideCents / 100).toFixed(2) : '', { inputMode: 'decimal', message: displayName(p), okText: 'Save price' });
    if (v == null) return;
    const cents = v.trim() === '' ? null : parseMoneyToCents(v);
    if (v.trim() !== '' && cents == null) return toast('Not a valid price', 'err');
    await saveProduct({ ...p, priceOverrideCents: cents });
    toast(cents == null ? 'Manual price removed' : `Price set to ${formatCents(cents)}`);
  };

  return (
    <div>
      <PageHeader title="Review Price Matching" back="#/settings" />
      <div className="p-3 space-y-3">
        <div className="flex gap-2">
          {(
            [
              ['review', 'Needs review'],
              ['unmatched', 'Unmatched'],
              ['matched', 'Matched'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`flex-1 h-10 rounded-full text-sm font-semibold border ${tab === k ? 'bg-brand text-white border-brand' : 'bg-white border-gray-300'}`}>
              {label} ({by(k).length})
            </button>
          ))}
        </div>
        {!list.length && (
          <Empty title="No catalog products yet">
            <p>The products you see now come straight from the price sheet, so they are already priced. Upload the catalog to match its products against the price sheet.</p>
          </Empty>
        )}
        {list.length > 0 && !shown.length && <Empty title="Nothing here" />}
        <ul className="space-y-2">
          {shown.map((p) => {
            const linked = p.priceItemId ? priceItemById.get(p.priceItemId) : undefined;
            const sugg = p.suggestedPriceItemId ? priceItemById.get(p.suggestedPriceItemId) : undefined;
            const reasons = sugg ? rankCandidates(p, [sugg], 1)[0]?.reasons || [] : [];
            return (
              <li key={p.id}>
                <Card className="p-3">
                  <div className="text-xs text-gray-500">{[p.department, p.category].filter(Boolean).join(' › ')}</div>
                  <div className="font-semibold break-words">{p.catalogName || displayName(p)}</div>
                  {p.priceOverrideCents != null && (
                    <div className="mt-1">
                      <Badge tone="blue">Manual price {formatCents(p.priceOverrideCents)}</Badge>
                    </div>
                  )}
                  {tab === 'matched' && linked && (
                    <div className="mt-2 text-sm bg-green-50 rounded-xl p-2">
                      <div className="text-green-800 font-semibold">
                        Matched ({p.matchMethod === 'manual' ? 'confirmed by you' : p.matchMethod === 'sku' ? 'same SKU' : 'automatic'})
                      </div>
                      <div>
                        {linked.brand} {linked.desc} — <b>{formatCents(linked.priceCents)}</b>
                      </div>
                    </div>
                  )}
                  {tab === 'review' && sugg && (
                    <div className="mt-2 text-sm bg-amber-50 rounded-xl p-2">
                      <div className="text-amber-900 font-semibold">Suggested match ({Math.round(p.matchScore * 100)}%)</div>
                      <div>
                        {sugg.brand} {sugg.desc}
                      </div>
                      <div>
                        Suggested case price: <b>{formatCents(sugg.priceCents)}</b>
                      </div>
                      {reasons.length > 0 && <div className="text-xs text-amber-800 mt-1">{reasons.join(' · ')}</div>}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-2 mt-3">
                    {tab === 'review' && sugg && (
                      <button
                        type="button"
                        className={`${btnPrimary} h-11`}
                        onClick={async () => {
                          await confirmMatch(p.id, sugg.id);
                          toast('Match confirmed and saved');
                        }}
                      >
                        Confirm Match
                      </button>
                    )}
                    <button type="button" className={`${btnSecondary} h-11`} onClick={() => setPicking(p)}>
                      {tab === 'matched' ? 'Change match' : 'Choose Different Product'}
                    </button>
                    <div className="flex gap-2">
                      {tab !== 'unmatched' || p.matchMethod !== 'manual' ? (
                        <button
                          type="button"
                          className={`${btnSecondary} h-11 flex-1 text-sm`}
                          onClick={async () => {
                            await leaveUnmatched(p.id);
                            toast('Left unmatched (remembered)');
                          }}
                        >
                          Leave Unmatched
                        </button>
                      ) : null}
                      <button type="button" className={`${btnSecondary} h-11 flex-1 text-sm`} onClick={() => manualPrice(p)}>
                        Enter price
                      </button>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-gray-500 px-1">{priceItems.length} price sheet lines available. Confirmed matches are remembered for future catalog and price sheet uploads.</p>
      </div>
      <PriceItemPicker
        product={picking}
        open={!!picking}
        onClose={() => setPicking(null)}
        onPick={async (item) => {
          if (!picking) return;
          await confirmMatch(picking.id, item.id);
          setPicking(null);
          toast(`Matched to ${item.brand} ${item.desc} (${formatCents(item.priceCents)})`);
        }}
      />
    </div>
  );
}

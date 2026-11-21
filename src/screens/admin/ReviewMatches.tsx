import { useState } from 'react';
import { Badge, Card, Empty, PageHeader, btnPrimary, btnSecondary, confirmDialog, promptDialog, toast } from '../../components/ui';
import { PriceItemPicker } from '../../components/PriceItemPicker';
import { useApp, confirmMatch, leaveUnmatched, saveProduct } from '../../state/store';
import { formatCents, parseMoneyToCents } from '../../lib/money';
import { displayName } from '../../lib/products';
import { rankCandidates } from '../../lib/matching';
import { auditCounts } from '../../db/importer';
import type { MatchStatus, Product } from '../../types';

const BASIS: Record<string, string> = {
  sku: 'same SKU',
  exact: 'verified: brand, size and case count identical',
  naming: 'verified: same product, written differently',
  'flavors-listed': 'verified: price line says "& FLAVORS"',
  'brand-level': 'verified: one price for the brand at this size and count',
  'count-cut-off': 'verified: case count cut off in the catalog, confirmed',
};
const why = (p: Product) => (p.matchFlags && p.matchFlags.length ? p.matchFlags : null);

export function ReviewMatchesScreen() {
  const products = useApp((s) => s.products);
  const priceItemById = useApp((s) => s.priceItemById);
  const priceItems = useApp((s) => s.priceItems);
  const [tab, setTab] = useState<MatchStatus>('review');
  const [picking, setPicking] = useState<Product | null>(null);
  const list = products.filter((p) => p.origin !== 'pricesheet' && p.active);
  const by = (s: MatchStatus) => list.filter((p) => p.matchStatus === s);
  const shown = by(tab);
  const audit = auditCounts(list.filter((p) => p.origin === 'catalog' && !p.missingFromCatalog));

  const manualPrice = async (p: Product) => {
    const v = await promptDialog('Enter case price manually', p.priceOverrideCents != null ? (p.priceOverrideCents / 100).toFixed(2) : '', { inputMode: 'decimal', message: displayName(p), okText: 'Save price' });
    if (v == null) return;
    const cents = v.trim() === '' ? null : parseMoneyToCents(v);
    if (v.trim() !== '' && cents == null) return toast('Not a valid price', 'err');
    await saveProduct({ ...p, priceOverrideCents: cents });
    toast(cents == null ? 'Manual price removed' : `Price set to ${formatCents(cents)}`);
  };
  const groupMap = new Map<string, Product[]>();
  for (const p of by('review')) if (p.suggestedPriceItemId && priceItemById.has(p.suggestedPriceItemId)) groupMap.set(p.suggestedPriceItemId, [...(groupMap.get(p.suggestedPriceItemId) || []), p]);
  const groups = [...groupMap.entries()].filter(([, ps]) => ps.length > 1).sort((a, b) => b[1].length - a[1].length);

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
        {audit.total > 0 && (
          <Card className="p-3 text-sm" data-testid="audit-card">
            <div className="font-semibold">Pricing audit</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1">
              <span>Verified automatically</span>
              <b className="text-right">{audit.verified}</b>
              <span>Confirmed by you</span>
              <b className="text-right">{audit.manual}</b>
              <span>Waiting for your review</span>
              <b className="text-right">{audit.review}</b>
              <span>No price line</span>
              <b className="text-right">{audit.unmatched}</b>
              <span>Coverage</span>
              <b className="text-right">{audit.coverage}%</b>
            </div>
            <p className="text-xs text-gray-500 mt-1">Coverage = verified + confirmed by you, out of {audit.total}. Suggestions are not priced and not counted in totals until you confirm them.</p>
          </Card>
        )}
        {!list.length && (
          <Empty title="No catalog products yet">
            <p>The products you see now come straight from the price sheet, so they are already priced. Upload the catalog to match its products against the price sheet.</p>
          </Empty>
        )}
        {list.length > 0 && !shown.length && <Empty title="Nothing here" />}
        {tab === 'review' && groups.length > 0 && (
          <details className="bg-white rounded-2xl border border-gray-200 p-3">
            <summary className="font-semibold cursor-pointer">Confirm several at once ({groups.length} suggested price lines)</summary>
            <p className="text-xs text-gray-500 mt-1 mb-2">Each button confirms every product suggested for that price line. You'll see the full list before anything is saved.</p>
            <ul className="divide-y divide-gray-100">
              {groups.map(([itemId, ps]) => {
                const it = priceItemById.get(itemId)!;
                return (
                  <li key={itemId} className="py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0 text-sm">
                      <div className="font-medium break-words">
                        {it.brand} {it.desc} — {formatCents(it.priceCents)}
                      </div>
                      <div className="text-gray-500">{ps.length} products</div>
                    </div>
                    <button
                      type="button"
                      className="h-10 px-3 rounded-xl bg-brand text-white text-sm font-semibold"
                      onClick={async () => {
                        const ok = await confirmDialog(
                          `Confirm ${ps.length} products?`,
                          <>
                            <div className="mb-2">
                              All of these will be priced at <b>{formatCents(it.priceCents)}</b> per case ({it.brand} {it.desc}):
                            </div>
                            <ul className="text-sm max-h-60 overflow-auto list-disc pl-5">
                              {ps.map((p) => (
                                <li key={p.id}>{displayName(p)}</li>
                              ))}
                            </ul>
                          </>,
                          'Confirm all',
                        );
                        if (!ok) return;
                        for (const p of ps) await confirmMatch(p.id, itemId);
                        toast(`${ps.length} matches confirmed and saved`);
                      }}
                    >
                      Confirm all {ps.length}
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        <ul className="space-y-2">
          {shown.map((p) => {
            const linked = p.priceItemId ? priceItemById.get(p.priceItemId) : undefined;
            const sugg = p.suggestedPriceItemId ? priceItemById.get(p.suggestedPriceItemId) : undefined;
            const reasons = why(p) ?? (sugg ? rankCandidates(p, [sugg], 1)[0]?.reasons || [] : []);
            return (
              <li key={p.id}>
                <Card className="p-3">
                  <div className="text-xs text-gray-500">{[p.department, p.category].filter(Boolean).join(' › ')}</div>
                  <div className="font-semibold break-words">{displayName(p)}</div>
                  {p.priceOverrideCents != null && (
                    <div className="mt-1">
                      <Badge tone="blue">Manual price {formatCents(p.priceOverrideCents)}</Badge>
                    </div>
                  )}
                  {tab === 'matched' && linked && (
                    <div className="mt-2 text-sm bg-green-50 rounded-xl p-2">
                      <div className="text-green-800 font-semibold">
                        Matched ({p.matchMethod === 'manual' ? 'confirmed by you' : p.matchMethod === 'rule90' ? 'accepted by your 90% rule' : (p.matchBasis && BASIS[p.matchBasis]) || (p.matchMethod === 'sku' ? 'same SKU' : 'automatic')})
                      </div>
                      <div>
                        {linked.brand} {linked.desc} — <b>{formatCents(linked.priceCents)}</b>
                      </div>
                      {p.matchMethod !== 'manual' && p.matchNotes && p.matchNotes.length > 0 && <div className="text-xs text-green-900 mt-1">{p.matchNotes.join(' · ')}</div>}
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
                  {tab === 'unmatched' && p.matchMethod !== 'manual' && (
                    <div className="mt-2 text-sm bg-gray-50 rounded-xl p-2" data-testid="closest-line">
                      {sugg ? (
                        <>
                          <div className="text-gray-700 font-semibold">Closest price line — not a match ({Math.round(p.matchScore * 100)}%)</div>
                          <div>
                            {sugg.brand} {sugg.desc} — {formatCents(sugg.priceCents)}
                          </div>
                          {reasons.length > 0 && <div className="text-xs text-gray-600 mt-1">{reasons.join(' · ')}</div>}
                        </>
                      ) : (
                        <div className="text-gray-700">No Match Found on the price sheet</div>
                      )}
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

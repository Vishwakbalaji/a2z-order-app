import { memo, useCallback } from 'react';
import { TopBar } from '../components/TopBar';
import { Badge, Card, Icon, Stepper, btnDanger, btnSecondary, confirmDialog, promptDialog, toast } from '../components/ui';
import { PdfActions } from '../components/PdfActions';
import { pickStore } from '../components/StorePicker';
import { askQty } from './Products';
import { useApp, changeQty, setQty, setNote, clearDraft, finalizeOrder, cartTotals, getState, isFirstOrderPending } from '../state/store';
import { displayName, effectivePrice, titleName } from '../lib/products';
import { formatCents } from '../lib/money';
import type { DraftLine, Product } from '../types';
import type { PdfOrder } from '../lib/pdfExport';
import { go } from '../lib/router';

const CartRow = memo(function CartRow({ line, p, price }: { line: DraftLine; p: Product | undefined; price: number | null }) {
  const inc = useCallback(() => changeQty(line.productId, 1), [line.productId]);
  const dec = useCallback(() => changeQty(line.productId, -1), [line.productId]);
  if (!p) {
    return (
      <li className="px-3 py-3 border-b border-gray-100 flex items-center gap-2">
        <span className="flex-1 text-gray-500">Product no longer exists</span>
        <button type="button" className="text-red-600 font-semibold" onClick={() => setQty(line.productId, 0)}>
          Remove
        </button>
      </li>
    );
  }
  const name = `${titleName(p)} ${p.variation}`.trim();
  return (
    <li className="px-3 py-3 border-b border-gray-100" data-testid="cart-row">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold leading-snug break-words">{titleName(p) || p.variation}</div>
          {titleName(p) && p.variation && <div className="text-gray-800 leading-snug break-words">{p.variation}</div>}
          <div className="text-sm mt-0.5">
            {price != null ? (
              <span className="text-gray-600 tabular-nums">{formatCents(price)} per case</span>
            ) : (
              <span className="text-amber-700 font-semibold">Price not added</span>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={async () => {
            if (await confirmDialog('Remove product?', name, 'Remove', true)) setQty(line.productId, 0);
          }}
          className="w-10 h-10 -mr-1 -mt-1 flex items-center justify-center text-gray-400"
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <Stepper qty={line.qty} onInc={inc} onDec={dec} onTapQty={() => askQty(p, line.qty)} label={name} />
        <span className="text-xs text-gray-500">case{line.qty === 1 ? '' : 's'}</span>
        <div className="flex-1 text-right">
          <div className="text-xs text-gray-500">Line total</div>
          <div className="font-bold tabular-nums" data-testid="line-total">
            {price != null ? formatCents(price * line.qty) : '—'}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={async () => {
          const v = await promptDialog('Note for this product', line.note || '', { message: 'Shown under the product name in the PDF (e.g. flavors: 2 Coke, 1 Sprite).', okText: 'Save' });
          if (v != null) setNote(line.productId, v.trim());
        }}
        className="mt-2 text-sm text-brand font-medium flex items-center gap-1"
      >
        <Icon name="note" className="w-4 h-4" />
        {line.note ? <span className="text-gray-700 font-normal break-words">Note: {line.note}</span> : 'Add note'}
      </button>
    </li>
  );
});

export function CartScreen() {
  const storeId = useApp((s) => s.settings.selectedStoreId);
  const stores = useApp((s) => s.stores);
  const drafts = useApp((s) => s.drafts);
  const productById = useApp((s) => s.productById);
  const priceItemById = useApp((s) => s.priceItemById);
  const settings = useApp((s) => s.settings);
  const store = stores.find((s) => s.id === storeId);
  const lines = (storeId && drafts.get(storeId)) || [];
  const totals = cartTotals(lines, getState());

  const buildPdfOrder = (): PdfOrder | null => {
    if (!store) return null;
    const s = getState();
    return {
      company: { companyName: s.settings.companyName, companyAddress: s.settings.companyAddress, companyPhone: s.settings.companyPhone },
      logoDataUrl: s.settings.logoDataUrl,
      store: { name: store.name, address: store.address, phone: store.phone, manager: store.manager },
      rep: { name: s.settings.repName, phone: s.settings.repPhone },
      date: new Date(),
      lines: lines.map((l) => {
        const p = s.productById.get(l.productId);
        return { name: p ? displayName(p) : '(deleted product)', qty: l.qty, priceCents: p ? effectivePrice(p, s.priceItemById) : null, note: l.note };
      }),
      totals: cartTotals(lines, s),
      // shown (not used up) while this new store's first order is still a draft
      newStoreFirstOrder: isFirstOrderPending(store.id, s),
    };
  };

  return (
    <div className="min-h-full flex flex-col">
      <div className="sticky top-0 z-10 shadow-sm">
        <TopBar />
      </div>
      {!store ? (
        <div className="p-6 text-center">
          <p className="text-gray-600 mb-4">Select a store to see its cart. Each store has its own separate order.</p>
          <button type="button" className={`${btnSecondary} mx-auto`} onClick={() => pickStore()}>
            Select store
          </button>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 text-sm text-gray-600 bg-gray-50 border-b border-gray-200">
            <div className="truncate">{store.address}</div>
            {(store.phone || store.manager) && <div className="truncate">{[store.manager, store.phone].filter(Boolean).join(' · ')}</div>}
          </div>
          {isFirstOrderPending(store.id) && (
            <div className="mx-3 mt-3 p-3 rounded-xl bg-red-50 border border-red-300 text-red-800 text-sm" data-testid="new-store-banner">
              <b>NEW STORE — FIRST ORDER.</b> The order PDF shows this label. It is used up when you finalize this order; later orders won't show it.
            </div>
          )}
          {totals.unpricedLines > 0 && (
            <div className="mx-3 mt-3 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-sm flex gap-2" role="alert">
              <Icon name="alert" className="w-5 h-5 shrink-0" />
              <span>
                <b>{totals.unpricedLines} product(s) have no price</b> ({totals.unpricedCases} case{totals.unpricedCases === 1 ? '' : 's'}). They are still ordered, but the Total Order Value below does not include them.
              </span>
            </div>
          )}
          {lines.length === 0 ? (
            <div className="text-center py-14 px-6 text-gray-500">
              <p className="font-semibold text-gray-700 text-lg mb-1">Cart is empty</p>
              <p className="mb-4">Use + on the Products screen to add cases.</p>
              <button type="button" className={`${btnSecondary} mx-auto`} onClick={() => go('products')}>
                Browse products
              </button>
            </div>
          ) : (
            <ul className="bg-white mt-3 border-y border-gray-200">
              {lines.map((l) => {
                const p = productById.get(l.productId);
                return <CartRow key={l.productId} line={l} p={p} price={p ? effectivePrice(p, priceItemById) : null} />;
              })}
            </ul>
          )}

          {lines.length > 0 && (
            <div className="p-3 space-y-3">
              <Card className="p-4" >
                <div className="grid grid-cols-3 gap-2 text-center" data-testid="cart-summary">
                  <div>
                    <div className="text-xs text-gray-500">Total Products</div>
                    <div className="text-2xl font-bold tabular-nums" data-testid="total-products">{totals.products}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Total Cases</div>
                    <div className="text-2xl font-bold tabular-nums" data-testid="total-cases">{totals.cases}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Order Value</div>
                    <div className="text-xl font-bold tabular-nums text-brand" data-testid="total-value">{formatCents(totals.valueCents)}</div>
                  </div>
                </div>
                {totals.unpricedLines > 0 && <p className="text-xs text-amber-800 mt-2 text-center">Excludes {totals.unpricedLines} unpriced product(s) — total is incomplete.</p>}
              </Card>
              {!settings.repPhone && (
                <p className="text-sm text-gray-600 px-1">
                  Tip: add your phone number in <a href="#/settings" className="text-brand font-semibold underline">Settings</a> so it appears on the PDF.
                </p>
              )}
              <PdfActions getOrder={buildPdfOrder} />
              <button
                type="button"
                className={`${btnSecondary} w-full border-brand text-brand`}
                onClick={async () => {
                  const ok = await confirmDialog(
                    'Finalize this order?',
                    <>
                      Saves a permanent copy in Order History ({totals.products} products, {totals.cases} cases) and empties this store's cart. You can still download the PDFs from Order History.
                      {totals.unpricedLines > 0 && <b className="block mt-2 text-amber-800">{totals.unpricedLines} product(s) have no price.</b>}
                    </>,
                    'Finalize',
                  );
                  if (!ok) return;
                  try {
                    const o = await finalizeOrder(store.id);
                    toast(`Order ${o.orderNo} saved`);
                    go('orders/' + o.id);
                  } catch (e) {
                    toast((e as Error).message, 'err');
                  }
                }}
              >
                <Icon name="check" /> Finalize Order
              </button>
              <button
                type="button"
                className={`${btnDanger} w-full`}
                onClick={async () => {
                  if (await confirmDialog('Clear this cart?', `Remove all ${totals.products} products from ${store.name}'s draft order?`, 'Clear cart', true)) clearDraft(store.id);
                }}
              >
                Clear cart
              </button>
              <div className="h-2" />
            </div>
          )}
        </>
      )}
      {lines.length > 0 && store && (
        <div className="sticky bottom-0 z-10 bg-brand text-white px-4 py-2 flex items-center justify-between text-sm font-semibold shadow-lg">
          <span>
            {totals.products} products · {totals.cases} cases
          </span>
          <span className="tabular-nums text-base">
            {formatCents(totals.valueCents)}
            {totals.unpricedLines > 0 && <Badge tone="amber">+{totals.unpricedLines} unpriced</Badge>}
          </span>
        </div>
      )}
    </div>
  );
}

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from '../components/TopBar';
import { Icon, Stepper, promptDialog } from '../components/ui';
import { pickStore } from '../components/StorePicker';
import { useApp, changeQty, setQty, updateSettings } from '../state/store';
import { search } from '../lib/search';
import { effectivePrice, titleName } from '../lib/products';
import { formatCents } from '../lib/money';
import type { Product } from '../types';
import { ProductThumb } from '../components/ProductImage';

const PAGE = 60;

async function ensureStoreThen(fn: () => boolean) {
  if (fn()) return;
  const id = await pickStore('Choose the store for this order first. Each store has its own separate cart.');
  if (id) fn();
}

export async function askQty(p: Product, current: number) {
  const v = await promptDialog(`Cases: ${titleName(p)} ${p.variation}`, current ? String(current) : '', { inputMode: 'numeric', okText: 'Set', message: 'Number of cases' });
  if (v == null) return;
  const n = parseInt(v.replace(/\D/g, '') || '0', 10);
  await ensureStoreThen(() => setQty(p.id, n));
}

const ProductRow = memo(function ProductRow({ p, qty, price }: { p: Product; qty: number; price: number | null }) {
  const inc = useCallback(() => ensureStoreThen(() => changeQty(p.id, 1)), [p.id]);
  const dec = useCallback(() => {
    changeQty(p.id, -1);
  }, [p.id]);
  const tap = useCallback(() => askQty(p, qty), [p, qty]);
  const label = `${titleName(p)} ${p.variation}`.trim();
  return (
    <li className={`row-cv flex items-center gap-2.5 px-3 py-2.5 border-b border-gray-100 ${qty > 0 ? 'bg-brand-light/60' : 'bg-white'}`} data-testid="product-row">
      <ProductThumb p={p} size={72} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold leading-snug text-[15px] break-words">{titleName(p) || p.variation}</div>
        {titleName(p) && p.variation && <div className="text-[15px] text-gray-800 leading-snug break-words">{p.variation}</div>}
        <div className="mt-0.5 text-[15px]">
          {price != null ? (
            <span className="font-bold text-gray-900 tabular-nums">
              {formatCents(price)}
              <span className="font-normal text-gray-500 text-sm"> / case</span>
            </span>
          ) : (
            <span className="text-amber-700 font-semibold text-sm">Price Not Listed</span>
          )}
        </div>
      </div>
      <Stepper qty={qty} onInc={inc} onDec={dec} onTapQty={tap} label={label} />
    </li>
  );
});

export function ProductsScreen() {
  const browseIds = useApp((s) => s.browseIds);
  const index = useApp((s) => s.index);
  const productById = useApp((s) => s.productById);
  const priceItemById = useApp((s) => s.priceItemById);
  const departments = useApp((s) => s.departments);
  const drafts = useApp((s) => s.drafts);
  const storeId = useApp((s) => s.settings.selectedStoreId);
  const notice = useApp((s) => s.settings.dataNotice);

  const [q, setQ] = useState(() => sessionStorage.getItem('q') || '');
  const [dept, setDept] = useState(() => sessionStorage.getItem('dept') || 'All');
  const dq = useDeferredValue(q);
  useEffect(() => {
    try {
      sessionStorage.setItem('q', q);
      sessionStorage.setItem('dept', dept);
    } catch {
      /* ignore */
    }
  }, [q, dept]);

  const qtyMap = useMemo(() => new Map((storeId ? drafts.get(storeId) || [] : []).map((l) => [l.productId, l.qty])), [drafts, storeId]);
  const deptIds = useMemo(() => (dept === 'All' ? browseIds : browseIds.filter((id) => (productById.get(id)?.department || 'Other') === dept)), [dept, browseIds, productById]);
  const ids = useMemo(() => search(dq, deptIds, index), [dq, deptIds, index]);
  const allCount = useMemo(() => (dept !== 'All' && dq.trim() && ids.length === 0 ? search(dq, browseIds, index).length : 0), [dept, dq, ids, browseIds, index]);

  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [ids]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setLimit((l) => l + PAGE), { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ids.length, limit]);

  const showHeaders = !dq.trim() && dept === 'All';
  const visible = ids.slice(0, limit);
  const rows: React.ReactNode[] = [];
  let lastDept = '';
  for (const id of visible) {
    const p = productById.get(id);
    if (!p) continue;
    const d = p.department || 'Other';
    if (showHeaders && d !== lastDept) {
      rows.push(
        <li key={'h-' + d} className="bg-gray-100 px-3 py-1.5 text-xs font-bold tracking-wide text-gray-600 uppercase border-b border-gray-200">
          {d}
        </li>,
      );
      lastDept = d;
    }
    rows.push(<ProductRow key={id} p={p} qty={qtyMap.get(id) || 0} price={effectivePrice(p, priceItemById)} />);
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="sticky top-0 z-10 shadow-sm">
        <TopBar />
        <div className="bg-white px-3 pb-2">
          <div className="relative">
            <Icon name="search" className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search products, brands, sizes…"
              aria-label="Search products"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="w-full h-12 pl-10 pr-10 rounded-xl bg-gray-100 border border-transparent focus:bg-white focus:border-brand focus:outline-none"
            />
            {q && (
              <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-gray-500">
                <Icon name="x" />
              </button>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar mt-2 -mx-3 px-3" role="tablist" aria-label="Departments">
            {['All', ...departments].map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={dept === d}
                onClick={() => setDept(d)}
                className={`shrink-0 h-9 px-3.5 rounded-full text-sm font-semibold border ${dept === d ? 'bg-brand text-white border-brand' : 'bg-white text-gray-700 border-gray-300'}`}
              >
                {d === 'All' ? 'All' : d.charAt(0) + d.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
      {notice && !q && (
        <div className="mx-3 my-2 p-3 rounded-xl bg-brand-light border border-brand/30 text-sm" role="status" data-testid="data-notice">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <div className="font-semibold text-brand">{notice.title}</div>
              <div className="text-gray-700 mt-0.5">{notice.text}</div>
              {notice.review > 0 && (
                <a href="#/settings/review" className="inline-block mt-1 text-brand font-semibold underline">
                  Review {notice.review} products without a confirmed price
                </a>
              )}
            </div>
            <button type="button" aria-label="Dismiss" className="w-9 h-9 -mr-1 -mt-1 flex items-center justify-center text-gray-500" onClick={() => updateSettings({ dataNotice: null })}>
              <Icon name="x" />
            </button>
          </div>
        </div>
      )}
      <div className="px-3 py-1.5 text-xs text-gray-500 bg-gray-50 border-b border-gray-200" aria-live="polite">
        {ids.length} product{ids.length === 1 ? '' : 's'} · prices are per case
      </div>
      <ul className="bg-white flex-1">{rows}</ul>
      {ids.length === 0 && (
        <div className="text-center text-gray-500 py-12 px-6">
          <p className="font-semibold text-gray-700">No products found</p>
          {allCount > 0 && (
            <button type="button" className="mt-3 text-brand font-semibold underline" onClick={() => setDept('All')}>
              Show {allCount} result{allCount === 1 ? '' : 's'} in all departments
            </button>
          )}
        </div>
      )}
      {limit < ids.length && <div ref={sentinel} className="h-20" />}
    </div>
  );
}


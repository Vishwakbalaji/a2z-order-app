import { useMemo, useState } from 'react';
import { Badge, Card, Empty, Field, Icon, PageHeader, btnPrimary, btnSecondary, inputCls, promptDialog, toast } from '../../components/ui';
import { PriceItemPicker } from '../../components/PriceItemPicker';
import { useApp, saveProduct, addManualProduct, setPriceItemPrice, confirmMatch, priceOf } from '../../state/store';
import { buildIndex, search } from '../../lib/search';
import { displayName, unitsFromText } from '../../lib/products';
import { formatCents, parseMoneyToCents, centsToInput } from '../../lib/money';
import { go } from '../../lib/router';
import type { PriceItem, Product } from '../../types';

export function ManageProductsScreen() {
  const products = useApp((s) => s.products);
  const priceItems = useApp((s) => s.priceItems);
  const priceItemById = useApp((s) => s.priceItemById);
  const [tab, setTab] = useState<'products' | 'prices'>(() => (sessionStorage.getItem('mp-tab') as 'prices') || 'products');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'noprice' | 'disabled'>('all');
  const index = useMemo(() => buildIndex(products), [products]);
  const sorted = useMemo(() => [...products].sort((a, b) => a.order - b.order).map((p) => p.id), [products]);
  const ids = useMemo(() => search(q, sorted, index), [q, sorted, index]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const list = ids
    .map((id) => byId.get(id)!)
    .filter((p) => (filter === 'disabled' ? !p.active : filter === 'noprice' ? p.active && priceOf(p.id) == null : true))
    .slice(0, 300);
  const pq = q.trim().toLowerCase();
  const lines = [...priceItems].sort((a, b) => a.order - b.order).filter((i) => !pq || `${i.section} ${i.brand} ${i.desc}`.toLowerCase().includes(pq));
  const setT = (t: 'products' | 'prices') => {
    setTab(t);
    try {
      sessionStorage.setItem('mp-tab', t);
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <PageHeader
        title="Products & Prices"
        back="#/settings"
        right={
          <a href="#/settings/products/new" className="h-10 px-3 rounded-xl bg-brand text-white font-semibold flex items-center gap-1 text-sm">
            <Icon name="plus" className="w-4 h-4" /> Add
          </a>
        }
      />
      <div className="p-3 space-y-3">
        <div className="flex gap-2">
          <button type="button" onClick={() => setT('products')} className={`flex-1 h-10 rounded-full text-sm font-semibold border ${tab === 'products' ? 'bg-brand text-white border-brand' : 'bg-white border-gray-300'}`}>
            Products ({products.length})
          </button>
          <button type="button" onClick={() => setT('prices')} className={`flex-1 h-10 rounded-full text-sm font-semibold border ${tab === 'prices' ? 'bg-brand text-white border-brand' : 'bg-white border-gray-300'}`}>
            Price sheet lines ({priceItems.length})
          </button>
        </div>
        <input type="search" className={inputCls} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products and prices" />
        {tab === 'products' ? (
          <>
            <div className="flex gap-2">
              {(
                [
                  ['all', 'All'],
                  ['noprice', 'No price'],
                  ['disabled', 'Disabled'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setFilter(k)} className={`h-9 px-3 rounded-full text-sm font-semibold border ${filter === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300'}`}>
                  {l}
                </button>
              ))}
            </div>
            {!list.length && <Empty title="No products" />}
            <ul className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
              {list.map((p) => {
                const price = priceOf(p.id);
                return (
                  <li key={p.id}>
                    <a href={`#/settings/products/${p.id}`} className="flex items-center gap-2 px-3 py-2.5 active:bg-gray-50">
                      <div className="flex-1 min-w-0">
                        <div className={`font-medium break-words ${!p.active ? 'line-through text-gray-400' : ''}`}>{displayName(p)}</div>
                        <div className="text-xs text-gray-500 flex gap-1 flex-wrap items-center">
                          {p.department || 'No department'}
                          {p.origin === 'pricesheet' && <Badge>price sheet</Badge>}
                          {p.origin === 'catalog' && <Badge tone="blue">catalog</Badge>}
                          {p.origin === 'manual' && <Badge tone="blue">added by you</Badge>}
                          {p.priceOverrideCents != null && <Badge tone="amber">manual price</Badge>}
                          {p.priceItemId && priceItemById.get(p.priceItemId)?.missingFromLatest && <Badge tone="red">not on latest sheet</Badge>}
                          {p.missingFromCatalog && <Badge tone="red">not in latest catalog</Badge>}
                          {p.matchStatus === 'review' && p.origin !== 'pricesheet' && <Badge tone="amber">needs review</Badge>}
                        </div>
                      </div>
                      <span className={`tabular-nums font-semibold ${price == null ? 'text-amber-700 text-sm' : ''}`}>{price == null ? 'Price not added' : formatCents(price)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-500 px-1">Changing a line's price updates every product linked to it, and all draft carts. Completed orders keep their original prices.</p>
            <ul className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
              {lines.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    className="w-full text-left flex items-center gap-2 px-3 py-2.5 active:bg-gray-50"
                    onClick={async () => {
                      const v = await promptDialog('Case price', centsToInput(i.priceCents), { inputMode: 'decimal', message: `${i.brand} ${i.desc}`, okText: 'Save' });
                      if (v == null) return;
                      const c = parseMoneyToCents(v);
                      if (c == null) return toast('Not a valid price', 'err');
                      await setPriceItemPrice(i.id, c);
                      toast('Price updated');
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium break-words">
                        {i.brand} {i.desc}
                      </div>
                      <div className="text-xs text-gray-500 flex gap-1 flex-wrap">
                        {i.section}
                        {i.prevPriceCents != null && <Badge tone="amber">was {formatCents(i.prevPriceCents)}</Badge>}
                        {i.missingFromLatest && <Badge tone="red">not on latest sheet</Badge>}
                      </div>
                    </div>
                    <span className="tabular-nums font-bold">{formatCents(i.priceCents)}</span>
                    <Icon name="edit" className="w-4 h-4 text-gray-400" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

type Form = { department: string; category: string; brand: string; name: string; variation: string; units: string; sku: string; active: boolean; override: string };

export function ProductEditScreen({ id }: { id: string }) {
  const productById = useApp((s) => s.productById);
  const priceItemById = useApp((s) => s.priceItemById);
  const departments = useApp((s) => s.departments);
  const p = id === 'new' ? null : productById.get(id) || null;
  const [f, setF] = useState<Form>(() => ({
    department: p?.department || '',
    category: p?.category || '',
    brand: p?.brand || '',
    name: p?.name || '',
    variation: p?.variation || '',
    units: p?.unitsPerCase != null ? String(p.unitsPerCase) : '',
    sku: p?.sku || '',
    active: p?.active ?? true,
    override: centsToInput(p?.priceOverrideCents),
  }));
  const [linkId, setLinkId] = useState<string | null>(p?.priceItemId || null);
  const [picking, setPicking] = useState(false);
  if (id !== 'new' && !p) return <><PageHeader title="Product" back="#/settings/products" /><Empty title="Product not found" /></>;
  const linked: PriceItem | undefined = linkId ? priceItemById.get(linkId) : undefined;
  const up = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const isSheet = p?.origin === 'pricesheet';

  const save = async () => {
    const override = f.override.trim() === '' ? null : parseMoneyToCents(f.override);
    if (f.override.trim() !== '' && override == null) return toast('Manual price is not a valid amount', 'err');
    if (!f.brand.trim() && !f.name.trim() && !f.variation.trim()) return toast('Enter at least a brand or name', 'err');
    const units = f.units.trim() ? parseInt(f.units, 10) : unitsFromText(f.variation);
    const base = {
      department: f.department.trim(),
      category: f.category.trim(),
      brand: f.brand.trim(),
      name: f.name.trim(),
      variation: f.variation.trim(),
      unitsPerCase: Number.isFinite(units as number) ? (units as number) : null,
      sku: f.sku.trim(),
      active: f.active,
      priceOverrideCents: override,
    };
    if (!p) {
      await addManualProduct({ ...base, catalogName: '', priceItemId: linkId });
      toast('Product added');
    } else {
      await saveProduct({ ...p, ...base });
      if (linkId && linkId !== p.priceItemId) await confirmMatch(p.id, linkId);
      toast('Product saved');
    }
    go('settings/products');
  };

  return (
    <div>
      <PageHeader title={p ? 'Edit Product' : 'Add Product'} back="#/settings/products" />
      <div className="p-3 space-y-3">
        <Card className="p-4">
          <datalist id="depts">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <Field label="Department">
            <input className={inputCls} value={f.department} onChange={up('department')} list="depts" />
          </Field>
          <Field label="Category">
            <input className={inputCls} value={f.category} onChange={up('category')} />
          </Field>
          <Field label="Brand">
            <input className={inputCls} value={f.brand} onChange={up('brand')} />
          </Field>
          <Field label="Product name">
            <input className={inputCls} value={f.name} onChange={up('name')} />
          </Field>
          <Field label="Size / case configuration" hint="e.g. 500ML / 24CT">
            <input className={inputCls} value={f.variation} onChange={up('variation')} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Units per case">
              <input className={inputCls} value={f.units} onChange={up('units')} inputMode="numeric" />
            </Field>
            <Field label="SKU / code">
              <input className={inputCls} value={f.sku} onChange={up('sku')} />
            </Field>
          </div>
          <label className="flex items-center gap-3 py-2">
            <input type="checkbox" className="w-5 h-5 accent-brand" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            <span className="font-medium">Active (uncheck to disable a discontinued product)</span>
          </label>
        </Card>
        <Card className="p-4">
          <h2 className="font-bold mb-2">Case price</h2>
          {linked ? (
            <div className="text-sm bg-gray-50 rounded-xl p-2 mb-2">
              <div className="text-gray-500">Linked price sheet line</div>
              <div className="font-semibold">
                {linked.brand} {linked.desc} — {formatCents(linked.priceCents)}
              </div>
              <div className="text-xs text-gray-400">From {linked.sourceFile}</div>
            </div>
          ) : (
            <p className="text-sm text-amber-800 mb-2">Not linked to a price sheet line.</p>
          )}
          {!isSheet && (
            <button type="button" className={`${btnSecondary} w-full h-11 mb-3`} onClick={() => setPicking(true)}>
              {linked ? 'Change price sheet line' : 'Link to price sheet line'}
            </button>
          )}
          <Field label="Manual case price (optional)" hint="Overrides the price sheet. Leave empty to use the linked price sheet line.">
            <input className={inputCls} value={f.override} onChange={up('override')} inputMode="decimal" placeholder="e.g. 12.50" />
          </Field>
        </Card>
        {p && (
          <Card className="p-4 text-xs text-gray-500 space-y-1">
            <div>Source: {p.origin === 'pricesheet' ? 'price sheet' : p.origin === 'catalog' ? 'catalog' : 'added manually'}</div>
            {p.catalogName && <div>Original catalog name: {p.catalogName}</div>}
            {linked && <div>Original price sheet text: {linked.raw}</div>}
            <div>Match status: {p.matchStatus}</div>
          </Card>
        )}
        <button type="button" className={`${btnPrimary} w-full`} onClick={save}>
          Save
        </button>
      </div>
      <PriceItemPicker
        product={p || ({ brand: f.brand, name: f.name, variation: f.variation, sku: f.sku, unitsPerCase: null, catalogName: '' } as Product)}
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(it) => {
          setLinkId(it.id);
          setPicking(false);
        }}
      />
    </div>
  );
}

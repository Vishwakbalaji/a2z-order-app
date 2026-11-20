import { useMemo, useState } from 'react';
import { Badge, Sheet, inputCls } from './ui';
import { useApp } from '../state/store';
import { rankCandidates } from '../lib/matching';
import { tokens } from '../lib/normalize';
import { formatCents } from '../lib/money';
import type { PriceItem, Product } from '../types';

/** Search the price sheet and pick a line. Best automatic candidates are listed first. */
export function PriceItemPicker({ product, open, onClose, onPick }: { product: Product | null; open: boolean; onClose: () => void; onPick: (item: PriceItem) => void }) {
  const items = useApp((s) => s.priceItems);
  const [q, setQ] = useState('');
  const cands = useMemo(() => (product ? rankCandidates(product, items, 6) : []), [product, items]);
  const list = useMemo(() => {
    const qt = tokens(q);
    const base = qt.length ? items.filter((i) => {
      const t = tokens(`${i.section} ${i.brand} ${i.desc} ${i.sku}`);
      return qt.every((w) => t.some((x) => x.startsWith(w) || (w.length >= 3 && x.includes(w))));
    }) : items;
    return [...base].sort((a, b) => a.order - b.order).slice(0, 150);
  }, [q, items]);
  const Row = ({ i, hint }: { i: PriceItem; hint?: string }) => (
    <li>
      <button type="button" onClick={() => onPick(i)} className="w-full text-left py-2.5 flex items-center gap-2 active:bg-gray-50">
        <div className="flex-1 min-w-0">
          <div className="font-medium break-words">
            {i.brand} {i.desc}
          </div>
          <div className="text-xs text-gray-500">
            {i.section}
            {hint ? ` · ${hint}` : ''}
          </div>
        </div>
        <span className="font-bold tabular-nums">{formatCents(i.priceCents)}</span>
      </button>
    </li>
  );
  return (
    <Sheet open={open} onClose={onClose} title="Choose price sheet line">
      {product && (
        <p className="text-sm text-gray-600 mb-2">
          For: <b>{product.catalogName || [product.brand, product.name, product.variation].join(' ')}</b>
        </p>
      )}
      <input className={`${inputCls} mb-2`} type="search" placeholder="Search the price sheet" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search price sheet" />
      {!q && cands.length > 0 && (
        <>
          <div className="text-xs font-bold text-gray-500 uppercase mt-2">Suggestions</div>
          <ul className="divide-y divide-gray-100 mb-2">
            {cands.map((c) => (
              <Row key={c.item.id} i={c.item} hint={`${Math.round(c.score * 100)}% · ${c.reasons.join(', ')}`} />
            ))}
          </ul>
          <div className="text-xs font-bold text-gray-500 uppercase">All lines</div>
        </>
      )}
      <ul className="divide-y divide-gray-100">
        {list.map((i) => (
          <Row key={i.id} i={i} />
        ))}
      </ul>
      {!list.length && <p className="text-gray-500 py-6 text-center">No lines match. <Badge>Tip</Badge> try fewer words.</p>}
    </Sheet>
  );
}

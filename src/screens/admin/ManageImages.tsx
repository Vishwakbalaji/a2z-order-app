import { useMemo, useRef, useState } from 'react';
import { Badge, Card, Empty, Icon, PageHeader, confirmDialog, inputCls, toast } from '../../components/ui';
import { BeveragePlaceholder, openImagePreview } from '../../components/ProductImage';
import { useApp, setProductImage, clearProductImage } from '../../state/store';
import { IMAGE_STATUS_LABEL, bundledImage, bundledUrls, imageCounts, imageState, photoToDataUrl, resolveImage } from '../../lib/images';
import { displayName } from '../../lib/products';
import { tokens } from '../../lib/normalize';
import type { Product } from '../../types';

type Tab = 'review' | 'none' | 'with' | 'all';
const TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = { verified: 'green', approx: 'green', approved: 'green', manual: 'blue', review: 'amber', none: 'gray', rejected: 'red' };
const PAGE = 40;

export function ManageImagesScreen() {
  const products = useApp((s) => s.products);
  const overrides = useApp((s) => s.imageOverrides);
  const catalog = useMemo(() => products.filter((p) => p.origin !== 'pricesheet' && p.active), [products]);
  const counts = useMemo(() => imageCounts(catalog, overrides), [catalog, overrides]);
  const [tab, setTab] = useState<Tab>(() => (counts.review ? 'review' : 'none'));
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<Product | null>(null);

  const list = useMemo(() => {
    const qt = tokens(q);
    return catalog.filter((p) => {
      const st = imageState(p, overrides);
      const inTab = tab === 'all' || (tab === 'review' && st === 'review') || (tab === 'none' && (st === 'none' || st === 'rejected')) || (tab === 'with' && ['verified', 'approx', 'approved', 'manual'].includes(st));
      if (!inTab) return false;
      if (!qt.length) return true;
      const t = tokens(`${displayName(p)} ${p.category} ${p.department}`);
      return qt.every((w) => t.some((x) => x.startsWith(w)));
    });
  }, [catalog, overrides, tab, q]);

  const pick = (p: Product) => {
    setUploadFor(p);
    fileRef.current?.click();
  };
  const onFile = async (f: File | undefined) => {
    const p = uploadFor;
    if (fileRef.current) fileRef.current.value = '';
    if (!f || !p) return;
    try {
      const url = await photoToDataUrl(f, 400);
      await setProductImage(p, 'manual', url);
      toast('Photo saved for this product');
    } catch {
      toast('Could not read that photo', 'err');
    }
  };

  const tabs: [Tab, string, number][] = [
    ['review', 'Needs review', counts.review],
    ['none', 'No image', counts.none + counts.rejected],
    ['with', 'With image', counts.verified + counts.approx + counts.approved + counts.manual],
    ['all', 'All', counts.total],
  ];

  return (
    <div>
      <PageHeader title="Manage Product Images" back="#/settings" />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" data-testid="image-file" onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="p-3 space-y-3">
        <Card className="p-3 text-sm" data-testid="image-summary">
          <div className="font-semibold">Image matching summary</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1">
            <span>Total catalog products</span>
            <b className="text-right">{counts.total}</b>
            <span>Verified images</span>
            <b className="text-right">{counts.verified}</b>
            <span>Accepted approximate</span>
            <b className="text-right">{counts.approx}</b>
            <span>Approved / added by you</span>
            <b className="text-right">{counts.approved + counts.manual}</b>
            <span>Needs review</span>
            <b className="text-right">{counts.review}</b>
            <span>Image not found</span>
            <b className="text-right">{counts.none + counts.rejected}</b>
            <span>Image coverage</span>
            <b className="text-right">{counts.coverage}%</b>
          </div>
          <p className="text-xs text-gray-500 mt-1">Coverage counts only accepted pictures. Pictures that need review are not shown to customers until you approve them. Your decisions are kept through app updates.</p>
        </Card>

        <div className="grid grid-cols-4 gap-1.5">
          {tabs.map(([k, label, n]) => (
            <button
              key={k}
              type="button"
              onClick={() => (setTab(k), setLimit(PAGE))}
              className={`min-h-10 px-1 py-1 rounded-xl text-xs font-semibold border leading-tight ${tab === k ? 'bg-brand text-white border-brand' : 'bg-white border-gray-300'}`}
            >
              {label} ({n})
            </button>
          ))}
        </div>
        <input className={inputCls} placeholder="Search products" aria-label="Search products" value={q} onChange={(e) => (setQ(e.target.value), setLimit(PAGE))} />

        {!list.length && <Empty title="Nothing here" />}
        <ul className="space-y-2">
          {list.slice(0, limit).map((p) => {
            const st = imageState(p, overrides);
            const b = bundledImage(p);
            const shown = resolveImage(p, overrides);
            const reviewUrl = st === 'review' && b ? bundledUrls(b).thumb : null;
            const thumb = shown?.thumb ?? reviewUrl;
            return (
              <li key={p.id} data-testid="image-row">
                <Card className="p-3">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className="shrink-0 w-20 h-20 rounded-xl border border-gray-100 bg-white flex items-center justify-center overflow-hidden"
                      onClick={() => shown && openImagePreview(p)}
                      aria-label={`Picture of ${displayName(p)}`}
                    >
                      {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" width={80} height={80} className="w-full h-full object-contain p-1" /> : <BeveragePlaceholder className="w-9 h-9" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-500">{[p.department, p.category].filter(Boolean).join(' › ')}</div>
                      <div className="font-semibold break-words leading-snug">{displayName(p)}</div>
                      <div className="mt-1 flex flex-wrap gap-1 items-center">
                        <Badge tone={TONE[st]}>{IMAGE_STATUS_LABEL[st]}</Badge>
                        {b && st !== 'manual' && st !== 'rejected' && <span className="text-xs text-gray-500">{b.confidence}%</span>}
                      </div>
                      {b?.note && st !== 'manual' && <div className="text-xs text-amber-800 mt-1">{b.note}</div>}
                      {b && st !== 'manual' && (
                        <a href={b.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-brand underline break-all">
                          Source: {b.source}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {st === 'review' && (
                      <>
                        <button type="button" className="h-10 rounded-xl bg-brand text-white text-sm font-semibold" onClick={async () => (await setProductImage(p, 'approved'), toast('Picture approved'))}>
                          Approve
                        </button>
                        <button type="button" className="h-10 rounded-xl border border-red-300 text-red-700 text-sm font-semibold" onClick={async () => (await setProductImage(p, 'rejected'), toast('Picture rejected'))}>
                          Reject
                        </button>
                      </>
                    )}
                    <button type="button" className="h-10 rounded-xl border border-gray-300 text-sm font-semibold flex items-center justify-center gap-1.5" onClick={() => pick(p)}>
                      <Icon name="camera" className="w-4 h-4" />
                      {shown ? 'Replace photo' : 'Add photo'}
                    </button>
                    {(st === 'verified' || st === 'approx' || st === 'approved' || st === 'manual') && (
                      <button
                        type="button"
                        className="h-10 rounded-xl border border-gray-300 text-sm font-semibold"
                        onClick={async () => {
                          if (!(await confirmDialog('Remove this picture?', 'The product will show a placeholder. You can add a photo later.', 'Remove', true))) return;
                          await setProductImage(p, 'rejected');
                          toast('Picture removed');
                        }}
                      >
                        Remove image
                      </button>
                    )}
                    {overrides.has(p.id) && (
                      <button type="button" className="h-10 rounded-xl border border-gray-300 text-sm font-semibold col-span-2" onClick={async () => (await clearProductImage(p.id), toast('Back to the app picture'))}>
                        {b ? 'Undo — use the app picture' : 'Undo'}
                      </button>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
        {list.length > limit && (
          <button type="button" className="w-full h-11 rounded-xl border border-gray-300 bg-white font-semibold" onClick={() => setLimit(limit + PAGE)}>
            Show more ({list.length - limit})
          </button>
        )}
        <details className="text-xs text-gray-500 px-1">
          <summary className="cursor-pointer">Image credits</summary>
          <p className="mt-1">
            Product photos come from Open Food Facts (openfoodfacts.org), contributed by its users and licensed under CC BY-SA 3.0 (creativecommons.org/licenses/by-sa/3.0). Each picture links to its source page above. Brand names and
            labels belong to their owners; pictures are shown only to identify the products.
          </p>
        </details>
      </div>
    </div>
  );
}

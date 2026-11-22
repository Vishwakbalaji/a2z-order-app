import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import { useApp } from '../state/store';
import { resolveImage, type ResolvedImage } from '../lib/images';
import { titleName } from '../lib/products';
import type { Product } from '../types';

/** Neutral bottle-and-can placeholder (shown while loading and when there is no picture). */
export function BeveragePlaceholder({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} text-gray-300`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2h3v3l1.5 2.5V21a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V7.5L8 5z" />
      <path d="M6.5 12h6" />
      <rect x="14.5" y="10" width="5" height="12" rx="1" />
      <path d="M14.5 13h5" />
    </svg>
  );
}

function Img({ img, alt, size }: { img: ResolvedImage | null; alt: string; size: number }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => setState('loading'), [img?.thumb]);
  return (
    <span className="relative flex items-center justify-center w-full h-full">
      {(!img || state !== 'ok') && <BeveragePlaceholder />}
      {img && state !== 'error' && (
        <img
          src={img.thumb}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          className={`absolute inset-0 w-full h-full object-contain p-0.5 transition-opacity duration-150 ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </span>
  );
}

/**
 * Product picture in a fixed square box (never overlaps text or buttons). Tapping it opens a larger
 * preview; it never changes the cart.
 */
export const ProductThumb = memo(function ProductThumb({ p, size = 64 }: { p: Product; size?: number }) {
  const overrides = useApp((s) => s.imageOverrides);
  const img = resolveImage(p, overrides);
  const name = `${titleName(p)} ${p.variation}`.trim();
  const box = { width: size, height: size };
  if (!img) {
    return (
      <span className="shrink-0 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center" style={box} data-testid="product-thumb" data-has-image="false" aria-hidden="true">
        <BeveragePlaceholder />
      </span>
    );
  }
  return (
    <button
      type="button"
      className="shrink-0 rounded-xl bg-white border border-gray-100 overflow-hidden active:opacity-70"
      style={box}
      onClick={() => openImagePreview(p)}
      aria-label={`Show picture: ${name}`}
      data-testid="product-thumb"
      data-has-image="true"
    >
      <Img img={img} alt={name} size={size} />
    </button>
  );
});

/* ----------------------------- preview ----------------------------- */

let previewing: Product | null = null;
const listeners = new Set<() => void>();
export function openImagePreview(p: Product | null) {
  previewing = p;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function ImagePreviewHost() {
  const p = useSyncExternalStore(subscribe, () => previewing);
  const overrides = useApp((s) => s.imageOverrides);
  const img = p ? resolveImage(p, overrides) : null;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [p?.id]);
  useEffect(() => {
    if (!p) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openImagePreview(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);
  if (!p || !img) return null;
  const name = titleName(p) || p.variation;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Picture: ${name}`} data-testid="image-preview">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close picture" onClick={() => openImagePreview(null)} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
        <div className="relative bg-white flex items-center justify-center" style={{ height: 'min(60vh, 380px)' }}>
          {!loaded && <img src={img.thumb} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-contain p-4 blur-[1px]" />}
          <img src={img.large} alt={name} onLoad={() => setLoaded(true)} className={`relative w-full h-full object-contain p-4 ${loaded ? '' : 'opacity-0'}`} />
        </div>
        <div className="px-4 pt-3 pb-4 border-t border-gray-100">
          <div className="font-semibold leading-snug break-words">{name}</div>
          {titleName(p) && p.variation && <div className="text-gray-700 break-words">{p.variation}</div>}
          {img.credit && (
            <div className="text-[11px] text-gray-400 mt-1 break-words">
              Photo: {img.credit}
            </div>
          )}
          {img.kind === 'manual' && <div className="text-[11px] text-gray-400 mt-1">Your photo</div>}
          <button type="button" className="mt-3 w-full h-11 rounded-xl bg-brand text-white font-semibold" onClick={() => openImagePreview(null)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

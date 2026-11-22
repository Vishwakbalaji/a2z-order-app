/**
 * Product pictures. One picture per catalog product, keyed by its permanent product id (never by name).
 *
 * Pictures shipped with the app are listed in src/data/productImages.ts (made with tests/tool-images.test.ts
 * after checking every picture by eye against brand, flavor, size and packaging). The files are small WebP
 * images in public/products/t (thumbnail, 160px) and public/products/l (preview, 480px).
 *
 * The owner's own decisions (approve / reject / his own photo) are stored per product in the
 * `productImages` table and always win over the shipped picture — app updates never change them.
 */
import type { Product, ProductImageOverride } from '../types';
import { PRODUCT_IMAGES, type BundledImage } from '../data/productImages';

export type ImageStatus = 'verified' | 'approx' | 'review' | 'none';
export const IMAGE_STATUS_LABEL: Record<ImageStatus | 'approved' | 'manual' | 'rejected', string> = {
  verified: 'Verified',
  approx: 'Accepted approximate match',
  review: 'Needs review',
  none: 'Image not found',
  approved: 'Approved by you',
  manual: 'Your photo',
  rejected: 'Removed by you',
};

export interface ResolvedImage {
  thumb: string;
  large: string;
  /** 'manual' = his photo, 'approved' = confirmed by him, otherwise the shipped status */
  kind: 'manual' | 'approved' | 'verified' | 'approx';
  credit: string | null;
  sourceUrl: string | null;
  official: boolean;
}

type ProductKey = Pick<Product, 'id'> & Partial<Pick<Product, 'catalogName' | 'origin'>>;

// Phones that loaded the catalog before products had permanent ids (Nov 2026) keep older random ids, so a
// picture is found by product id first and otherwise by the product's exact original catalog line (each of the
// catalog's lines is unique). Never by a similar-looking name.
const normLine = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();
let byLine: Map<string, BundledImage> | null = null;
let byLineSize = -1;
function lineIndex() {
  const n = Object.keys(PRODUCT_IMAGES).length;
  if (!byLine || n !== byLineSize) {
    byLine = new Map();
    for (const e of Object.values(PRODUCT_IMAGES)) byLine.set(normLine(e.name), e);
    byLineSize = n;
  }
  return byLine;
}
function shipped(p: ProductKey): BundledImage | undefined {
  const b = PRODUCT_IMAGES[p.id];
  if (b) return b;
  if (p.origin === 'pricesheet' || !p.catalogName) return undefined;
  return lineIndex().get(normLine(p.catalogName));
}

const base = () => (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || './';
export function bundledImage(p: ProductKey): BundledImage | undefined {
  return shipped(p);
}
export function bundledUrls(b: BundledImage) {
  return { thumb: `${base()}products/t/${b.file}`, large: `${base()}products/l/${b.file}` };
}

/**
 * The picture to show for a product, or null (placeholder). Pictures that still need review are NOT
 * shown until the owner approves them — no picture is better than a wrong one.
 */
export function resolveImage(p: ProductKey, overrides: Map<string, ProductImageOverride>): ResolvedImage | null {
  const o = overrides.get(p.id);
  if (o?.status === 'rejected') return null;
  if (o?.status === 'manual' && o.dataUrl) return { thumb: o.dataUrl, large: o.dataUrl, kind: 'manual', credit: null, sourceUrl: null, official: false };
  const b = shipped(p);
  if (!b) return null;
  if (o?.status === 'approved') return { ...bundledUrls(b), kind: 'approved', credit: b.credit, sourceUrl: b.sourceUrl, official: !!b.official };
  if (b.status === 'review') return null;
  return { ...bundledUrls(b), kind: b.status, credit: b.credit, sourceUrl: b.sourceUrl, official: !!b.official };
}

/** True when the product shows the brand's own official photo. */
export function hasOfficialImage(p: ProductKey, overrides: Map<string, ProductImageOverride>): boolean {
  const r = resolveImage(p, overrides);
  return !!r && r.official;
}

/** Status for the "Manage product images" screen. */
export function imageState(p: ProductKey, overrides: Map<string, ProductImageOverride>): ImageStatus | 'approved' | 'manual' | 'rejected' {
  const o = overrides.get(p.id);
  if (o?.status === 'rejected') return 'rejected';
  if (o?.status === 'manual' && o.dataUrl) return 'manual';
  const b = shipped(p);
  if (!b) return 'none';
  if (o?.status === 'approved') return 'approved';
  return b.status;
}

/** Image coverage: products with an accepted picture (verified, approximate, approved or his photo). */
export function imageCounts(products: ProductKey[], overrides: Map<string, ProductImageOverride>) {
  const c = { total: products.length, verified: 0, approx: 0, approved: 0, manual: 0, review: 0, none: 0, rejected: 0, coverage: 0, official: 0 };
  for (const p of products) {
    const st = imageState(p, overrides);
    c[st]++;
    if ((st === 'verified' || st === 'approx' || st === 'approved') && shipped(p)?.official) c.official++;
  }
  const accepted = c.verified + c.approx + c.approved + c.manual;
  c.coverage = c.total ? Math.round((accepted / c.total) * 1000) / 10 : 0;
  return c;
}

/** Resize a photo the owner picked to ≤ maxPx on the long side (WebP, JPEG fallback). Browser only. */
export async function photoToDataUrl(file: Blob, maxPx = 400): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  let url = canvas.toDataURL('image/webp', 0.82);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.85);
  return url;
}

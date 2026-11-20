/**
 * Converts pdf.js text content into simple positioned items (top-left origin, PDF points).
 * Works with both the browser build and the Node "legacy" build of pdfjs-dist.
 */
export interface TItem {
  page: number;
  x: number; // left
  y: number; // vertical centre-ish baseline, measured from top of page
  w: number;
  h: number; // font height
  str: string; // '' means a glyph with no text mapping (e.g. "(" or "-" in some PDFs)
}

export interface PageText {
  page: number;
  width: number;
  height: number;
  items: TItem[];
}

// Minimal structural types so we don't depend on pdf.js type exports.
interface PdfPageLike {
  getViewport(o: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
}
export interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}

const PUA = /[-]/g;
const PUA_ONLY = /^[-]+$/;

export async function extractPages(doc: PdfDocLike): Promise<PageText[]> {
  const pages: PageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: TItem[] = [];
    for (const raw of tc.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
      if (!raw || !raw.transform || typeof raw.str !== 'string') continue;
      const w = raw.width || 0;
      // Glyphs from embedded (Type3) fonts often have no Unicode mapping and come out
      // as Private Use Area characters — treat them as "unknown glyph" ('').
      if (PUA_ONLY.test(raw.str)) raw.str = '';
      else raw.str = raw.str.replace(PUA, ' ');
      // real spaces carry no information (gaps are measured from positions)
      if (raw.str !== '' && raw.str.trim() === '') continue;
      // an empty string with a width is a glyph with no text mapping (e.g. "(" "-" ":")
      if (raw.str === '' && w <= 0) continue;
      const [, , c, d, e, f] = raw.transform;
      const h = raw.height || Math.hypot(c, d) || 10;
      items.push({ page: p, x: e, y: vp.height - f, w, h, str: raw.str });
    }
    pages.push({ page: p, width: vp.width, height: vp.height, items });
  }
  return pages;
}

/** True if the PDF has (almost) no extractable text — probably a scanned image. */
export function looksScanned(pages: PageText[]): boolean {
  const chars = pages.reduce((n, p) => n + p.items.reduce((m, it) => m + it.str.replace(/\s/g, '').length, 0), 0);
  return chars < 20 * Math.max(1, pages.length);
}

/**
 * Join items that sit on one visual line into text, repairing glyphs that have
 * no text mapping: a pair of unmapped glyphs around a word -> "(WORD)",
 * a single unmapped glyph between two words -> "-".
 */
export function joinItems(items: TItem[]): string {
  const its = [...items].sort((a, b) => a.x - b.x);
  const parts: { t: string | null; it: TItem }[] = its.map((it) => ({ t: it.str === '' ? null : it.str, it }));
  // resolve unknown glyphs
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].t !== null) continue;
    const next = parts[i + 1];
    const after = parts[i + 2];
    if (next && next.t !== null && after && after.t === null) {
      parts[i].t = '(';
      after.t = ')';
      i += 2;
    } else if (i > 0 && parts[i - 1].t !== null && next && next.t !== null) {
      parts[i].t = '-';
    } else {
      parts[i].t = ' ';
    }
  }
  let out = '';
  let prevEnd = -Infinity;
  let prevTok = '';
  for (const p of parts) {
    const gap = p.it.x - prevEnd;
    const tok = p.t as string;
    const glue = tok === ')' || tok === '-' || prevTok === '(' || prevTok === '-';
    if (out && !glue && gap > p.it.h * 0.2) out += ' ';
    out += tok;
    prevEnd = p.it.x + p.it.w;
    prevTok = tok;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Group items into lines (by y proximity). */
export function groupLines(items: TItem[]): TItem[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last) {
      const ly = last.reduce((s, i) => s + i.y, 0) / last.length;
      const lh = Math.max(...last.map((i) => i.h));
      if (Math.abs(it.y - ly) <= Math.max(lh, it.h) * 0.45) {
        last.push(it);
        continue;
      }
    }
    lines.push([it]);
  }
  return lines;
}

/**
 * Layout-aware price sheet parser.
 *
 * Handles price lists laid out as one or more columns where every priced row is
 * "[description] .... $price", optionally grouped under a brand label cell on the
 * left that spans several rows (like the A2Z "Price Deals" flyer), and section
 * headers (WATER, SODA, ...) that become departments.
 *
 * Brand labels are vertically centred on their group of rows, so rows are assigned
 * to labels with a small dynamic program that minimises the distance between each
 * label's centre and the centre of its rows. The result is ALWAYS shown to the user
 * in an editable preview before anything is imported.
 */
import { parseMoneyToCents } from '../money';
import { normText } from '../normalize';
import { groupLines, joinItems, type PageText, type TItem } from './textItems';

export interface ParsedPriceRow {
  section: string;
  brand: string;
  desc: string;
  priceCents: number;
  page: number;
  raw: string; // original text pieces for comparison
}

export interface ParseResult {
  rows: ParsedPriceRow[];
  warnings: string[];
}

const PRICE_RE = /^\$\s?\d{1,5}(?:,\d{3})*(?:\.\d{2})?$/;
const PLAIN_PRICE_RE = /^\d{1,5}\.\d{2}$/;

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

interface Row {
  y: number;
  price: TItem;
  descItems: TItem[];
  extra: string[]; // continuation lines
}
interface Label {
  y: number;
  text: string;
  h: number;
}

export function parsePriceSheet(pages: PageText[], knownBrands: string[] = []): ParseResult {
  const warnings: string[] = [];
  const out: ParsedPriceRow[] = [];
  const known = new Set(knownBrands.map((b) => normText(b)));
  const anyDollar = pages.some((p) => p.items.some((i) => PRICE_RE.test(i.str.trim())));
  const isPrice = (s: string) => (anyDollar ? PRICE_RE.test(s.trim()) : PLAIN_PRICE_RE.test(s.trim()));

  for (const page of pages) {
    const prices = page.items.filter((i) => isPrice(i.str));
    if (!prices.length) continue;

    // 1) columns = clusters of price right edges
    const rights = prices.map((p) => p.x + p.w).sort((a, b) => a - b);
    const clusters: number[][] = [];
    for (const r of rights) {
      const c = clusters[clusters.length - 1];
      if (c && r - c[c.length - 1] < page.width * 0.08) c.push(r);
      else clusters.push([r]);
    }
    const colRights = clusters.map((c) => Math.max(...c));

    colRights.forEach((colRight, ci) => {
      const colLeft = ci === 0 ? -1 : colRights[ci - 1] + 1;
      const inCol = page.items.filter((it) => {
        const cx = it.x + it.w / 2;
        return cx > colLeft && cx <= colRight + 4;
      });
      const colPrices = inCol.filter((i) => isPrice(i.str)).sort((a, b) => a.y - b.y);
      const others = inCol.filter((i) => !isPrice(i.str));
      const hRow = median(colPrices.map((p) => p.h)) || 10;

      // 2) items on priced rows -> find where the description column starts
      const onRow = (it: TItem, p: TItem) => Math.abs(it.y - p.y) <= Math.max(it.h, p.h) * 0.5;
      const xs: number[] = [];
      for (const p of colPrices) for (const it of others) if (onRow(it, p) && it.x < p.x && it.str) xs.push(Math.round(it.x));
      const counts = new Map<number, number>();
      xs.forEach((x) => counts.set(x, (counts.get(x) || 0) + 1));
      let descX = Math.min(...xs);
      let best = 0;
      counts.forEach((n, x) => {
        if (n > best || (n === best && x < descX)) {
          best = n;
          descX = x;
        }
      });
      if (!isFinite(descX)) descX = colLeft + 1;
      const isLabelItem = (it: TItem) => it.x + it.w < descX - 1;

      // 3) priced rows
      const used = new Set<TItem>();
      const rows: Row[] = colPrices.map((p) => {
        const descItems = others.filter((it) => !isLabelItem(it) && it.x < p.x && onRow(it, p));
        descItems.forEach((d) => used.add(d));
        return { y: p.y, price: p, descItems, extra: [] };
      });
      const firstY = rows[0].y;
      const lastY = rows[rows.length - 1].y;

      // 4) remaining non-label lines: wrapped description lines or section headers
      const rest = others.filter((it) => !used.has(it) && !isLabelItem(it));
      const headers: { y: number; text: string }[] = [];
      const wraps: { row: Row; y: number; items: TItem[] }[] = [];
      for (const line of groupLines(rest)) {
        const y = median(line.map((i) => i.y));
        const text = joinItems(line);
        if (!text.replace(/[^\w]/g, '')) continue;
        const minX = Math.min(...line.map((i) => i.x));
        const nearest = rows.reduce((a, r) => (Math.abs(r.y - y) < Math.abs(a.y - y) ? r : a), rows[0]);
        if (Math.abs(minX - descX) <= 2 && Math.abs(nearest.y - y) <= hRow * 1.3) {
          wraps.push({ row: nearest, y, items: line });
          continue;
        }
        if (y < firstY - hRow * 3.5 || y > lastY + hRow * 1.5) continue; // page header / footer
        headers.push({ y, text });
      }
      headers.sort((a, b) => a.y - b.y);
      // rebuild each wrapped row's description in top-to-bottom line order
      for (const row of rows) {
        const mine = wraps.filter((w) => w.row === row);
        if (!mine.length) continue;
        const lines = [{ y: row.y, items: row.descItems }, ...mine].filter((l) => l.items.length).sort((a, b) => a.y - b.y);
        row.descItems = [];
        row.extra = lines.map((l) => joinItems(l.items));
      }

      // 5) label lines
      const labelLines: Label[] = groupLines(others.filter(isLabelItem))
        .map((line) => ({ y: median(line.map((i) => i.y)), text: joinItems(line), h: median(line.map((i) => i.h)) }))
        .filter((l) => l.text.replace(/[^\w]/g, '') && l.y >= firstY - hRow * 1.5 && l.y <= lastY + hRow * 1.5);

      // 6) segment by section headers and assign brands
      const bounds = [-Infinity, ...headers.map((h) => h.y), Infinity];
      for (let s = 0; s < bounds.length - 1; s++) {
        const top = bounds[s], bottom = bounds[s + 1];
        const segRows = rows.filter((r) => r.y > top && r.y < bottom);
        if (!segRows.length) continue;
        const section = s === 0 ? '' : headers[s - 1].text;
        const segLabels = labelLines.filter((l) => l.y > top && l.y < bottom);
        const brands = assignBrands(segLabels, segRows.map((r) => r.y), known);
        if (brands.some((b) => b === '') && segLabels.length) warnings.push(`Page ${page.page}: some rows in "${section || 'top'}" have no brand label — please check.`);
        segRows.forEach((r, i) => {
          const descMain = joinItems(r.descItems);
          const desc = [descMain, ...r.extra].join(' ').replace(/\s+/g, ' ').trim();
          const priceCents = parseMoneyToCents(r.price.str);
          if (priceCents == null) return;
          out.push({
            section,
            brand: brands[i],
            desc,
            priceCents,
            page: page.page,
            raw: [brands[i], desc, r.price.str.trim()].filter(Boolean).join(' | '),
          });
        });
      }
    });
  }
  if (!out.length) warnings.push('No prices were found in this PDF.');
  return { rows: out, warnings };
}

/**
 * Assign each row (by y) to a brand label. Label lines may be merged into
 * multi-line labels ("COKE /", "FANTA /", "SPRITE &", "FLAVORS").
 */
export function assignBrands(labels: Label[], rowYs: number[], known: Set<string> = new Set()): string[] {
  const m = labels.length, n = rowYs.length;
  if (!m) return rowYs.map(() => '');
  const h0 = median(labels.map((l) => l.h)) || 10;
  const BRAND = 0.3, SKIP_LABEL = 3, ROW_NO_LABEL = 5, MAX_LINES = 5;
  const INF = 1e18;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(INF));
  const from: ({ i: number; j: number; label: string | null } | null)[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(null));
  dp[0][0] = 0;
  const labelText = (a: number, b: number) => labels.slice(a, b).map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();

  for (let i = 0; i <= m; i++) {
    for (let j = 0; j <= n; j++) {
      const cur = dp[i][j];
      if (cur >= INF) continue;
      if (i < m && cur + SKIP_LABEL < dp[i + 1][j]) {
        dp[i + 1][j] = cur + SKIP_LABEL;
        from[i + 1][j] = { i, j, label: null };
      }
      if (j < n && cur + ROW_NO_LABEL < dp[i][j + 1]) {
        dp[i][j + 1] = cur + ROW_NO_LABEL;
        from[i][j + 1] = { i, j, label: '' };
      }
      for (let i2 = i + 1; i2 <= Math.min(m, i + MAX_LINES); i2++) {
        let mergePen = 0;
        for (let k = i; k < i2 - 1; k++) {
          const g = (labels[k + 1].y - labels[k].y) / h0;
          mergePen += Math.max(0, g - 1.3) ** 2 * 4;
        }
        const lc = (labels[i].y + labels[i2 - 1].y) / 2;
        const text = labelText(i, i2);
        const bonus = known.has(normText(text)) ? -0.5 : 0;
        for (let j2 = j + 1; j2 <= n; j2++) {
          const rc = (rowYs[j] + rowYs[j2 - 1]) / 2;
          const dev = (lc - rc) / h0;
          // a label must sit inside the vertical span of its rows
          if (lc < rowYs[j] - h0 * 1.2 || lc > rowYs[j2 - 1] + h0 * 1.2) continue;
          const c = cur + dev * dev + mergePen + BRAND + bonus;
          if (c < dp[i2][j2]) {
            dp[i2][j2] = c;
            from[i2][j2] = { i, j, label: text };
          }
        }
      }
    }
  }
  const res: string[] = Array(n).fill('');
  let i = m, j = n;
  while (i > 0 || j > 0) {
    const f = from[i][j];
    if (!f) break;
    if (f.label !== null) for (let k = f.j; k < j; k++) res[k] = f.label;
    i = f.i;
    j = f.j;
  }
  return res;
}

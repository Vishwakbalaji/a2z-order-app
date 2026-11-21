// Tool (skipped unless OUT is set): OUT=/path/extract.json npx vitest run tests/tool-catalog-extract.test.ts
import fs from 'node:fs';
import { it } from 'vitest';
import { loadPdfPages } from './pdfNode';
import { assignBrands } from '../src/lib/pdf/priceSheetParser';
import { groupLines, joinItems } from '../src/lib/pdf/textItems';
import { normText, editDistance } from '../src/lib/normalize';

const PDF = new URL('./fixtures/A2Z_Beverages_Product_List_11.20.26.pdf', import.meta.url).pathname;

it.skipIf(!process.env.OUT)('extract catalog', async () => {
  const pages = await loadPdfPages(PDF);
  type Row = { table: 'L' | 'R'; page: number; y: number; text: string; geo?: string; txt?: string };
  const rows: Row[] = [];
  const labelsByTable: Record<'L' | 'R', { page: number; y: number; text: string }[]> = { L: [], R: [] };
  for (const pg of pages) {
    for (const table of ['L', 'R'] as const) {
      const inT = pg.items.filter((i) => (table === 'L' ? i.x + i.w / 2 < 306 : i.x + i.w / 2 >= 306) && i.str.trim() && !['Description', 'Group'].includes(i.str.trim()));
      const isLabel = (x: number) => (table === 'L' ? x > 190 : x > 455);
      const descLines = groupLines(inT.filter((i) => !isLabel(i.x))).map((l) => ({ y: l.reduce((s, i) => s + i.y, 0) / l.length, text: joinItems(l) }));
      const labLines = groupLines(inT.filter((i) => isLabel(i.x))).map((l) => ({ y: l.reduce((s, i) => s + i.y, 0) / l.length, text: joinItems(l), h: 8 }));
      labLines.forEach((l) => labelsByTable[table].push({ page: pg.page, y: l.y, text: l.text }));
      const geo = assignBrands(labLines, descLines.map((d) => d.y));
      descLines.forEach((d, i) => rows.push({ table, page: pg.page, y: d.y, text: d.text, geo: geo[i] }));
    }
  }
  // Method A: fill rows without a label from the previous row in the same table (group continues across a page)
  for (const t of ['L', 'R'] as const) {
    let last = '';
    for (const r of rows.filter((x) => x.table === t)) {
      if (!r.geo) r.geo = last ? `${last}` : '';
      last = r.geo!;
    }
  }
  // Method B: text-based sequential assignment over the ordered unique labels of each table
  const key = (s: string) => normText(s).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const sim = (desc: string, label: string) => {
    const d = key(desc).split(' ');
    const lt = key(label).split(' ').filter(Boolean);
    let hit = 0;
    for (const w of lt) if (d.some((x) => x === w || (w.length >= 4 && x.length >= 4 && editDistance(x, w, 1) <= 1) || (w.length >= 4 && x.startsWith(w.slice(0, Math.max(4, w.length - 1)))))) hit++;
    return lt.length ? hit / lt.length : 0;
  };
  for (const t of ['L', 'R'] as const) {
    const labs = labelsByTable[t];
    const labels: { text: string; page: number; y: number }[] = [];
    for (const l of labs) if (labels[labels.length - 1]?.text !== l.text) labels.push(l);
    let gi = 0;
    for (const r of rows.filter((x) => x.table === t)) {
      const cur = sim(r.text, labels[gi].text);
      let best = gi, bestS = cur;
      for (let k = gi + 1; k <= Math.min(labels.length - 1, gi + 4); k++) {
        const s = sim(r.text, labels[k].text);
        if (s > bestS) { best = k; bestS = s; }
      }
      if (bestS === 0) {
        // no text evidence at all: nearest label on the same page among current .. current+2
        const cands = labels.slice(gi, gi + 3).map((l, i) => ({ i: gi + i, d: l.page === r.page ? Math.abs(l.y - r.y) : 1e9 }));
        cands.sort((a, b) => a.d - b.d);
        if (cands[0].d < 1e9) best = cands[0].i;
        (r as Row & { noEvidence?: boolean }).noEvidence = true;
      }
      gi = best;
      r.txt = labels[gi].text;
    }
  }
  fs.writeFileSync(process.env.OUT!, JSON.stringify({ rows, labelsByTable }, null, 1));
});

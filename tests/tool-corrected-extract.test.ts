// Tool (skipped unless OUT is set): read A2Z_Corrected_Full_Catalog.pdf with pdf.js (independent of PyMuPDF)
// → [page, line, extra, price] for every product row. OUT=/path/rows.json npx vitest run tests/tool-corrected-extract.test.ts
import { it } from 'vitest';
import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

it.skipIf(!process.env.OUT)('extract corrected catalog rows with pdf.js', async () => {
  const data = new Uint8Array(fs.readFileSync(new URL('./fixtures/A2Z_Corrected_Full_Catalog.pdf', import.meta.url)));
  const doc = await getDocument({ data, verbosity: 0 }).promise;
  const rows: [number, string, string, string | null][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = (tc.items as { str: string; transform: number[] }[])
      .filter((i) => i.str.trim())
      .map((i) => ({ t: i.str.trim(), x: i.transform[4], y: vp.height - i.transform[5] }));
    for (const half of [0, 1]) {
      const lo = (half * vp.width) / 2;
      const cs = items.filter((i) => i.x >= lo && i.x < lo + vp.width / 2);
      const prods = cs.filter((i) => i.x - lo > 80 && i.x - lo < 300 && !i.t.startsWith('$') && !/^\d+ \/ 8$/.test(i.t) && !/^(PRODUCT|PRICE|GROUP)/.test(i.t) && i.y > 70 && i.y < vp.height - 30);
      for (const p of prods.sort((a, b) => a.y - b.y)) {
        const same = cs.filter((q) => q !== p && Math.abs(q.y - p.y) < 4 && q.x > p.x);
        const price = same.find((q) => q.t.startsWith('$'));
        rows.push([n, p.t, same.filter((q) => !q.t.startsWith('$')).map((q) => q.t).join(' '), price ? price.t : null]);
      }
    }
  }
  fs.writeFileSync(process.env.OUT!, JSON.stringify(rows));
});

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
const data = new Uint8Array(fs.readFileSync(process.argv[2]));
const doc = await getDocument({ data, useSystemFonts: false }).promise;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  console.log('PAGE', p, vp.width, vp.height, tc.items.length);
  for (const it of tc.items.slice(0, 400)) {
    if (!it.str.trim()) continue;
    const [a,b,c,d,e,f] = it.transform;
    console.log(JSON.stringify(it.str), 'x', e.toFixed(1), 'y', (vp.height-f).toFixed(1), 'w', it.width.toFixed(1), 'h', it.height.toFixed(1), it.fontName);
  }
}

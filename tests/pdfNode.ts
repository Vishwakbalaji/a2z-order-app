import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPages } from '../src/lib/pdf/textItems';

export async function loadPdfPages(path: string) {
  const data = new Uint8Array(fs.readFileSync(path));
  const doc = await getDocument({ data, verbosity: 0 }).promise;
  return extractPages(doc as never);
}

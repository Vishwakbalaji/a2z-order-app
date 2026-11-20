import { extractPages, type PageText } from './textItems';

/** Loads pdf.js on demand (it is large) and extracts positioned text from a PDF file. */
export async function loadPdfText(file: File): Promise<PageText[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  try {
    const doc = await task.promise;
    return await extractPages(doc as never);
  } finally {
    task.destroy();
  }
}

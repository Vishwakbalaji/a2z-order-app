import { useState } from 'react';
import { Icon, btnPrimary, btnSecondary, toast } from './ui';
import { buildOrderPdf, type PdfOrder } from '../lib/pdfExport';
import { canShareFiles, downloadBlob, shareFile } from '../lib/download';

export function PdfActions({ getOrder, disabled }: { getOrder: () => PdfOrder | null; disabled?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const share = canShareFiles();
  const run = async (kind: 'order' | 'detailed', mode: 'download' | 'share') => {
    const o = getOrder();
    if (!o) return;
    setBusy(kind + mode);
    try {
      const { blob, filename } = await buildOrderPdf(o, kind);
      if (mode === 'share') {
        const ok = await shareFile(blob, filename, filename);
        if (!ok) downloadBlob(blob, filename);
      } else {
        downloadBlob(blob, filename);
        toast(`Downloaded ${filename}`);
      }
    } catch (e) {
      toast('Could not create the PDF: ' + (e as Error).message, 'err');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button type="button" className={`${btnPrimary} flex-1`} disabled={disabled || !!busy} onClick={() => run('order', 'download')}>
          <Icon name="download" /> {busy === 'orderdownload' ? 'Creating…' : 'Download Order PDF'}
        </button>
        {share && (
          <button type="button" aria-label="Share Order PDF" className={`${btnPrimary} w-14 px-0`} disabled={disabled || !!busy} onClick={() => run('order', 'share')}>
            <Icon name="share" />
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 -mt-1 px-1">For the distributor — product names and case quantities only, no prices.</p>
      <div className="flex gap-2">
        <button type="button" className={`${btnSecondary} flex-1`} disabled={disabled || !!busy} onClick={() => run('detailed', 'download')}>
          <Icon name="download" /> {busy === 'detaileddownload' ? 'Creating…' : 'Download Detailed Order PDF'}
        </button>
        {share && (
          <button type="button" aria-label="Share Detailed PDF" className={`${btnSecondary} w-14 px-0`} disabled={disabled || !!busy} onClick={() => run('detailed', 'share')}>
            <Icon name="share" />
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 -mt-1 px-1">Your copy — with case prices, line totals and order value.</p>
    </div>
  );
}

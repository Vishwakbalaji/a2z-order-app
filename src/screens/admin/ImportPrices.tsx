import { useState } from 'react';
import { Badge, Card, Icon, PageHeader, btnPrimary, btnSecondary, confirmDialog, inputCls, toast } from '../../components/ui';
import { useApp, applyPriceSheet } from '../../state/store';
import { diffPriceSheet, type PriceDiff, type PriceRowInput } from '../../db/importer';
import { loadPdfText } from '../../lib/pdf/loadPdf';
import { looksScanned } from '../../lib/pdf/textItems';
import { parsePriceSheet } from '../../lib/pdf/priceSheetParser';
import { csvObjects, pick } from '../../lib/csv';
import { formatCents, parseMoneyToCents, centsToInput } from '../../lib/money';
import { go } from '../../lib/router';

interface EditRow extends PriceRowInput {
  include: boolean;
  priceText: string;
}

export function ImportPricesScreen() {
  const priceItems = useApp((s) => s.priceItems);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState('');
  const [rows, setRows] = useState<EditRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [diff, setDiff] = useState<PriceDiff | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'new' | 'changed'>('all');

  const refreshDiff = async (r: EditRow[]) => setDiff(await diffPriceSheet(r.filter((x) => x.include)));

  const onFile = async (f: File) => {
    setFileName(f.name);
    setRows(null);
    setDiff(null);
    setWarnings([]);
    setBusy('Reading file…');
    try {
      let parsed: PriceRowInput[] = [];
      const warns: string[] = [];
      if (/\.csv$/i.test(f.name) || f.type === 'text/csv') {
        for (const o of csvObjects(await f.text())) {
          const cents = parseMoneyToCents(pick(o, 'price', 'case_price', 'price_per_case', 'cost'));
          const desc = pick(o, 'description', 'desc', 'size', 'variation', 'product', 'product_name', 'name');
          if (cents == null || !desc) {
            warns.push(`Skipped row: ${Object.values(o).join(', ')}`);
            continue;
          }
          const brand = pick(o, 'brand');
          parsed.push({ section: pick(o, 'section', 'department', 'category'), brand, desc, sku: pick(o, 'sku', 'code', 'item_code', 'upc'), priceCents: cents, raw: Object.values(o).join(' | ') });
        }
      } else {
        const pages = await loadPdfText(f);
        if (looksScanned(pages)) {
          setWarnings([
            'This PDF has no readable text — it looks like a scanned image.',
            'Options: (1) ask the distributor for the original (non-scanned) PDF, (2) type the prices into a spreadsheet and upload it as CSV (columns: section, brand, description, price), or (3) send the PDF to your developer/AI assistant to convert it.',
          ]);
          setBusy('');
          return;
        }
        const res = parsePriceSheet(pages, priceItems.map((i) => i.brand));
        parsed = res.rows;
        warns.push(...res.warnings);
      }
      const r = parsed.map((p) => ({ ...p, include: true, priceText: centsToInput(p.priceCents) }));
      setRows(r);
      setWarnings(warns);
      await refreshDiff(r);
    } catch (e) {
      toast('Could not read the file: ' + (e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };

  const update = (i: number, patch: Partial<EditRow>) => {
    if (!rows) return;
    const next = rows.map((r, k) => (k === i ? { ...r, ...patch } : r));
    setRows(next);
    refreshDiff(next);
  };

  const statusOf = (r: EditRow) => diff?.rows.find((d) => d.row === r || (d.row.brand === r.brand && d.row.desc === r.desc));
  const included = rows?.filter((r) => r.include) || [];
  const invalid = included.filter((r) => parseMoneyToCents(r.priceText) == null || !r.desc.trim());
  const counts = { new: diff?.rows.filter((d) => d.status === 'new').length || 0, changed: diff?.rows.filter((d) => d.status === 'changed').length || 0, same: diff?.rows.filter((d) => d.status === 'same').length || 0 };

  const doImport = async () => {
    if (!rows || invalid.length) return;
    const ok = await confirmDialog(
      'Import price sheet?',
      <>
        {counts.new} new lines, {counts.changed} price changes, {counts.same} unchanged.
        {diff && diff.missing.length > 0 && <> {diff.missing.length} existing lines are not on this sheet — they are kept and flagged, not deleted.</>}
        <br />A safety snapshot is saved first. Draft carts use the new prices; completed orders keep their old prices.
      </>,
      'Import',
    );
    if (!ok) return;
    setBusy('Importing…');
    try {
      const sum = await applyPriceSheet(
        included.map((r) => ({ section: r.section.trim(), brand: r.brand.trim(), desc: r.desc.trim(), sku: r.sku, priceCents: parseMoneyToCents(r.priceText)!, raw: r.raw })),
        fileName || 'price-sheet',
      );
      toast(`Imported: ${sum.added} new, ${sum.changed} price changes`);
      go('settings/products');
    } catch (e) {
      toast('Import failed: ' + (e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <PageHeader title="Upload Price Sheet" back="#/settings" />
      <div className="p-3 space-y-3">
        <Card className="p-4 text-sm text-gray-700 space-y-2">
          <p>Upload the distributor's price sheet as a <b>PDF</b> (text-based) or <b>CSV</b>. You will see every extracted line before anything is saved.</p>
          <p className="text-gray-500">Lines are recognised by brand + description, so an updated sheet updates the existing prices. Nothing is deleted.</p>
          <label className={`${btnPrimary} w-full`}>
            <Icon name="upload" /> {fileName ? 'Choose another file' : 'Choose PDF or CSV'}
            <input type="file" accept=".pdf,.csv,application/pdf,text/csv" className="hidden" data-testid="price-file" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          {fileName && <p className="text-gray-500 break-all">File: {fileName}</p>}
        </Card>
        {busy && <p className="text-center text-gray-600 py-4">{busy}</p>}
        {warnings.length > 0 && (
          <Card className="p-3 bg-amber-50 border-amber-300 text-amber-900 text-sm space-y-1">
            {warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </Card>
        )}
        {rows && (
          <>
            <Card className="p-3">
              <div className="flex flex-wrap gap-2 text-sm mb-2">
                <Badge tone="blue">{rows.length} lines found</Badge>
                <Badge tone="green">{counts.new} new</Badge>
                <Badge tone="amber">{counts.changed} price changes</Badge>
                <Badge>{counts.same} unchanged</Badge>
                {diff && diff.missing.length > 0 && <Badge tone="red">{diff.missing.length} not on this sheet</Badge>}
              </div>
              {diff && diff.duplicates.length > 0 && <p className="text-sm text-red-700">Duplicate lines (only the first is used): {diff.duplicates.join('; ')}</p>}
              <div className="flex gap-2 mt-2">
                {(['all', 'new', 'changed'] as const).map((f) => (
                  <button key={f} type="button" onClick={() => setFilter(f)} className={`h-9 px-3 rounded-full text-sm font-semibold border ${filter === f ? 'bg-brand text-white border-brand' : 'bg-white border-gray-300'}`}>
                    {f === 'all' ? 'All' : f === 'new' ? 'New' : 'Changed'}
                  </button>
                ))}
              </div>
            </Card>
            <ul className="space-y-2" data-testid="price-preview">
              {rows.map((r, i) => {
                const st = statusOf(r);
                if (filter !== 'all' && st?.status !== filter) return null;
                const bad = parseMoneyToCents(r.priceText) == null || !r.desc.trim();
                return (
                  <li key={i}>
                    <Card className={`p-3 ${!r.include ? 'opacity-50' : ''} ${bad && r.include ? 'border-red-400' : ''}`}>
                      <div className="flex items-start gap-2">
                        <input type="checkbox" className="w-5 h-5 mt-0.5 accent-brand" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} aria-label="Include line" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-500">{r.section || 'No section'}</div>
                          <div className="font-semibold break-words">
                            {r.brand} {r.desc}
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="font-bold tabular-nums">{parseMoneyToCents(r.priceText) != null ? formatCents(parseMoneyToCents(r.priceText)) : 'Invalid price'}</span>
                            {st?.status === 'new' && <Badge tone="green">New</Badge>}
                            {st?.status === 'changed' && <Badge tone="amber">was {formatCents(st.oldCents)}</Badge>}
                            {st?.status === 'same' && <Badge>Unchanged</Badge>}
                          </div>
                          <div className="text-xs text-gray-400 mt-1 break-words">Original: {r.raw}</div>
                        </div>
                        <button type="button" onClick={() => setEditing(editing === i ? null : i)} className="w-10 h-10 flex items-center justify-center text-gray-500" aria-label="Edit line">
                          <Icon name="edit" />
                        </button>
                      </div>
                      {editing === i && (
                        <div className="grid grid-cols-2 gap-2 mt-3">
                          <input className={`${inputCls} col-span-2`} value={r.brand} placeholder="Brand" onChange={(e) => update(i, { brand: e.target.value })} />
                          <input className={`${inputCls} col-span-2`} value={r.desc} placeholder="Description / size" onChange={(e) => update(i, { desc: e.target.value })} />
                          <input className={inputCls} value={r.section} placeholder="Section" onChange={(e) => update(i, { section: e.target.value })} />
                          <input className={inputCls} value={r.priceText} inputMode="decimal" placeholder="Case price" onChange={(e) => update(i, { priceText: e.target.value })} />
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
            {diff && diff.missing.length > 0 && (
              <details className="bg-white rounded-2xl border border-gray-200 p-3 text-sm">
                <summary className="font-semibold cursor-pointer">{diff.missing.length} current lines are not on this sheet (kept, flagged)</summary>
                <ul className="mt-2 text-gray-600 space-y-1">
                  {diff.missing.map((m) => (
                    <li key={m.id}>
                      {m.brand} {m.desc} — {formatCents(m.priceCents)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="sticky bottom-0 bg-gray-50 py-2 space-y-2">
              {invalid.length > 0 && <p className="text-sm text-red-700">{invalid.length} included line(s) have a missing description or invalid price.</p>}
              <button type="button" className={`${btnPrimary} w-full`} disabled={!included.length || invalid.length > 0 || !!busy} onClick={doImport}>
                Import {included.length} lines
              </button>
              <button type="button" className={`${btnSecondary} w-full`} onClick={() => setRows(null)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

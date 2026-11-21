import { useState } from 'react';
import { Badge, Card, Icon, PageHeader, btnPrimary, btnSecondary, confirmDialog, inputCls, toast } from '../../components/ui';
import { useApp, applyCatalog } from '../../state/store';
import type { CatalogRowInput } from '../../db/importer';
import { loadPdfText } from '../../lib/pdf/loadPdf';
import { looksScanned } from '../../lib/pdf/textItems';
import { parseCatalog } from '../../lib/pdf/catalogParser';
import { csvObjects, pick, toCsv } from '../../lib/csv';
import { brandAlternatives } from '../../lib/normalize';
import { downloadBlob } from '../../lib/download';
import { go } from '../../lib/router';

interface EditRow extends CatalogRowInput {
  include: boolean;
}

const FIELDS: [keyof CatalogRowInput, string][] = [
  ['department', 'Department'],
  ['category', 'Category'],
  ['brand', 'Brand'],
  ['name', 'Product name'],
  ['variation', 'Size / case (e.g. 500ML / 24CT)'],
  ['sku', 'SKU / code'],
];

export function ImportCatalogScreen() {
  const priceItems = useApp((s) => s.priceItems);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState('');
  const [rows, setRows] = useState<EditRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [complete, setComplete] = useState(true);

  const onFile = async (f: File) => {
    setFileName(f.name);
    setRows(null);
    setWarnings([]);
    setBusy('Reading file…');
    try {
      let parsed: CatalogRowInput[] = [];
      let warns: string[] = [];
      if (/\.csv$/i.test(f.name) || f.type === 'text/csv') {
        for (const o of csvObjects(await f.text())) {
          const name = pick(o, 'name', 'product', 'product_name', 'description');
          if (!name) continue;
          const units = parseInt(pick(o, 'units_per_case', 'units', 'pack', 'case_pack'), 10);
          parsed.push({
            department: pick(o, 'department', 'dept'),
            category: pick(o, 'category', 'cat'),
            brand: pick(o, 'brand'),
            name,
            variation: pick(o, 'variation', 'size', 'size_case'),
            unitsPerCase: Number.isFinite(units) ? units : null,
            sku: pick(o, 'sku', 'code', 'item_code', 'upc'),
            // the catalog's own product text (used for matching and shown as "original name")
            raw: [pick(o, 'brand'), name, pick(o, 'variation', 'size', 'size_case')].filter(Boolean).join(' '),
          });
        }
      } else {
        const pages = await loadPdfText(f);
        if (looksScanned(pages)) {
          setWarnings([
            'This PDF has no readable text — it looks like a scanned image, so products cannot be extracted on the phone.',
            'Options: ask the distributor for the original PDF or an Excel/CSV export, fill in the CSV template below, or send the PDF to your developer/AI assistant to convert it to CSV.',
          ]);
          return;
        }
        const brands = priceItems.flatMap((i) => [i.brand, ...brandAlternatives(i.brand)]);
        const res = parseCatalog(pages, brands);
        parsed = res.rows;
        warns = res.warnings;
      }
      setRows(parsed.map((p) => ({ ...p, include: true })));
      setWarnings(warns);
    } catch (e) {
      toast('Could not read the file: ' + (e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };

  const update = (i: number, patch: Partial<EditRow>) => rows && setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const included = rows?.filter((r) => r.include && (r.name.trim() || r.brand.trim())) || [];

  const doImport = async () => {
    const ok = await confirmDialog('Import catalog?', `${included.length} products will be added or updated and matched against the price sheet. Nothing is deleted; a safety snapshot is saved first.`, 'Import');
    if (!ok) return;
    setBusy('Importing and matching prices…');
    try {
      const s = await applyCatalog(included, fileName || 'catalog', { complete });
      toast(`Catalog imported: ${s.added} new, ${s.updated} updated${s.discontinued ? `, ${s.discontinued} no longer in catalog` : ''}. ${s.matched} priced, ${s.review} to review, ${s.unmatched} unmatched.`);
      go('settings/review');
    } catch (e) {
      toast('Import failed: ' + (e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <PageHeader title="Upload Product Catalog" back="#/settings" />
      <div className="p-3 space-y-3">
        <Card className="p-4 text-sm text-gray-700 space-y-2">
          <p>Upload the full product catalog as a <b>PDF</b> (text-based) or <b>CSV</b>. Products are organised by department and category, then matched to the price sheet automatically. Only clear matches get a price; the rest go to <b>Review price matching</b>.</p>
          <label className={`${btnPrimary} w-full`}>
            <Icon name="upload" /> {fileName ? 'Choose another file' : 'Choose PDF or CSV'}
            <input type="file" accept=".pdf,.csv,application/pdf,text/csv" className="hidden" data-testid="catalog-file" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          <button
            type="button"
            className="text-brand font-semibold"
            onClick={() =>
              downloadBlob(
                new Blob([toCsv([['department', 'category', 'brand', 'name', 'variation', 'units_per_case', 'sku'], ['WATER', 'Bottled Water', 'Evian', 'Natural Spring Water', '500ML / 24CT', 24, '']])], { type: 'text/csv' }),
                'catalog-template.csv',
              )
            }
          >
            Download CSV template
          </button>
          {fileName && <p className="text-gray-500 break-all">File: {fileName}</p>}
        </Card>
        {busy && <p className="text-center text-gray-600 py-4">{busy}</p>}
        {warnings.length > 0 && (
          <details className="bg-amber-50 border border-amber-300 text-amber-900 text-sm rounded-2xl p-3" open={!rows?.length}>
            <summary className="font-semibold cursor-pointer">{warnings.length} note(s) from extraction</summary>
            {warnings.map((w, i) => (
              <p key={i} className="mt-1 break-words">
                {w}
              </p>
            ))}
          </details>
        )}
        {rows && rows.length > 0 && (
          <>
            <Card className="p-3 text-sm">
              <Badge tone="blue">{rows.length} products found</Badge> <span className="text-gray-600">Check them, edit with ✎, untick lines that are not products.</span>
              <label className="flex items-start gap-2 mt-3">
                <input type="checkbox" className="w-5 h-5 mt-0.5 accent-brand" checked={complete} onChange={(e) => setComplete(e.target.checked)} name="completeCatalog" />
                <span>
                  <b>This is the complete catalog.</b> Products from earlier catalogs that are not in this file get a "not in latest catalog" flag (they are kept). Untick when the file only adds a few products.
                </span>
              </label>
            </Card>
            <ul className="space-y-2">
              {rows.map((r, i) => (
                <li key={i}>
                  <Card className={`p-3 ${!r.include ? 'opacity-50' : ''}`}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" className="w-5 h-5 mt-0.5 accent-brand" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} aria-label="Include product" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-500">{[r.department || 'No department', r.category].filter(Boolean).join(' › ')}</div>
                        <div className="font-semibold break-words">{[r.brand, r.name, r.variation].filter(Boolean).join(' ')}</div>
                        <div className="text-xs text-gray-500">
                          {r.unitsPerCase ? `${r.unitsPerCase} per case` : 'Case count unknown'}
                          {r.sku ? ` · SKU ${r.sku}` : ''}
                        </div>
                        <div className="text-xs text-gray-400 break-words">Original: {r.raw}</div>
                      </div>
                      <button type="button" onClick={() => setEditing(editing === i ? null : i)} className="w-10 h-10 flex items-center justify-center text-gray-500" aria-label="Edit product">
                        <Icon name="edit" />
                      </button>
                    </div>
                    {editing === i && (
                      <div className="mt-3 space-y-2">
                        {FIELDS.map(([k, label]) => (
                          <input key={k} className={inputCls} placeholder={label} aria-label={label} value={String(r[k] ?? '')} onChange={(e) => update(i, { [k]: e.target.value } as Partial<EditRow>)} />
                        ))}
                        <input className={inputCls} placeholder="Units per case" inputMode="numeric" value={r.unitsPerCase ?? ''} onChange={(e) => update(i, { unitsPerCase: e.target.value ? parseInt(e.target.value, 10) || null : null })} />
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
            <div className="sticky bottom-0 bg-gray-50 py-2 space-y-2">
              <button type="button" className={`${btnPrimary} w-full`} disabled={!included.length || !!busy} onClick={doImport}>
                Import {included.length} products
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

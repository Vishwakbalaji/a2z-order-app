import { useEffect, useState } from 'react';
import { Card, Icon, PageHeader, btnPrimary, btnSecondary, confirmDialog, toast } from '../../components/ui';
import { makeBackup, restoreFromBackup, restoreFromSnapshot } from '../../state/store';
import { listSnapshots, validateBackup, type BackupFile } from '../../db/backup';
import { db } from '../../db/db';
import { canShareFiles, downloadBlob, shareFile, ymd } from '../../lib/download';
import type { ImportLog } from '../../types';

export function BackupScreen() {
  const [snaps, setSnaps] = useState<Awaited<ReturnType<typeof listSnapshots>>>([]);
  const [imports, setImports] = useState<ImportLog[]>([]);
  const [lastBackup, setLastBackup] = useState<string | null>(() => {
    try {
      return localStorage.getItem('lastBackup');
    } catch {
      return null;
    }
  });
  const refresh = async () => {
    setSnaps(await listSnapshots());
    setImports(await db.imports.orderBy('at').reverse().toArray());
  };
  useEffect(() => {
    refresh();
  }, []);

  const backupBlob = async () => {
    const b = await makeBackup();
    const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
    const name = `A2Z-Orders-Backup-${ymd()}.json`;
    const when = new Date().toLocaleString();
    try {
      localStorage.setItem('lastBackup', when);
    } catch {
      /* ignore */
    }
    setLastBackup(when);
    return { blob, name, b };
  };

  const onRestoreFile = async (f: File) => {
    let data: BackupFile;
    try {
      data = JSON.parse(await f.text());
    } catch {
      return toast('That file is not a valid backup (not JSON).', 'err');
    }
    const errs = validateBackup(data);
    if (errs.length) return toast('Cannot restore: ' + errs.join(' '), 'err');
    const c = data.counts || {};
    const ok = await confirmDialog(
      'Restore this backup?',
      <>
        Backup from <b>{new Date(data.exportedAt).toLocaleString()}</b>: {c.stores ?? '?'} stores, {c.orders ?? '?'} orders, {c.products ?? '?'} products, {c.priceItems ?? '?'} price lines.
        <br />
        <b>All current data on this phone will be replaced.</b> A safety snapshot of the current data is saved first.
      </>,
      'Restore',
      true,
    );
    if (!ok) return;
    try {
      await restoreFromBackup(data);
      toast('Backup restored');
      refresh();
    } catch (e) {
      toast('Restore failed: ' + (e as Error).message, 'err');
    }
  };

  return (
    <div>
      <PageHeader title="Backup & Restore" back="#/settings" />
      <div className="p-3 space-y-3">
        <Card className="p-4 space-y-3">
          <p className="text-sm text-gray-700">
            Your data lives in this browser on this phone. A backup file contains <b>everything</b> — stores, carts, order history, products, prices, matches and settings. Save it to Google Drive / iCloud / email regularly, and use it to move to a new phone.
          </p>
          <p className="text-sm text-gray-500">Last backup on this phone: {lastBackup || 'never'}</p>
          <button
            type="button"
            className={`${btnPrimary} w-full`}
            onClick={async () => {
              const { blob, name } = await backupBlob();
              downloadBlob(blob, name);
              toast(`Saved ${name}`);
            }}
          >
            <Icon name="download" /> Download backup file
          </button>
          {canShareFiles() && (
            <button
              type="button"
              className={`${btnSecondary} w-full`}
              onClick={async () => {
                const { blob, name } = await backupBlob();
                const ok = await shareFile(blob, name, name);
                if (!ok) downloadBlob(blob, name);
              }}
            >
              <Icon name="share" /> Share backup (Drive, email…)
            </button>
          )}
          <label className={`${btnSecondary} w-full`}>
            <Icon name="upload" /> Restore from backup file
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              data-testid="restore-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onRestoreFile(f);
              }}
            />
          </label>
        </Card>

        <Card className="p-4">
          <h2 className="font-bold mb-1">Automatic safety snapshots</h2>
          <p className="text-sm text-gray-500 mb-2">Taken automatically before every import or restore (last 6 kept, on this phone only).</p>
          {!snaps.length && <p className="text-sm text-gray-500">None yet.</p>}
          <ul className="divide-y divide-gray-100">
            {snaps.map((s) => (
              <li key={s.id} className="py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0 text-sm">
                  <div className="font-medium">{s.reason}</div>
                  <div className="text-gray-500">{new Date(s.at).toLocaleString()}</div>
                </div>
                <button
                  type="button"
                  className="text-brand font-semibold text-sm px-2 h-10"
                  onClick={async () => {
                    if (!(await confirmDialog('Go back to this snapshot?', 'All current data will be replaced by the data from this snapshot (a new snapshot of the current data is taken first).', 'Restore', true))) return;
                    try {
                      await restoreFromSnapshot(s.id);
                      toast('Snapshot restored');
                      refresh();
                    } catch (e) {
                      toast((e as Error).message, 'err');
                    }
                  }}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4">
          <h2 className="font-bold mb-2">Import history</h2>
          <ul className="divide-y divide-gray-100">
            {imports.map((i) => (
              <li key={i.id} className="py-2 text-sm">
                <div className="font-medium break-all">
                  {i.kind === 'catalog' ? 'Catalog' : 'Price sheet'}: {i.fileName}
                </div>
                <div className="text-gray-500">
                  {new Date(i.at).toLocaleString()} — {i.summary}
                </div>
                <details className="mt-1">
                  <summary className="text-brand cursor-pointer">Original extracted text ({i.rawLines.length} lines)</summary>
                  <pre className="whitespace-pre-wrap text-xs text-gray-600 bg-gray-50 rounded-lg p-2 mt-1 max-h-64 overflow-auto">{i.rawLines.join('\n')}</pre>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

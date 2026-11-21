import { useState } from 'react';
import { Card, PageHeader, btnPrimary, btnSecondary, toast } from '../components/ui';
import { pairWithKey } from '../sync/client';
import { useApp } from '../state/store';
import { go } from '../lib/router';

/** Opened from a pairing link (#/pair/<key>) on another phone. */
export function PairScreen({ pairKey }: { pairKey: string }) {
  const stores = useApp((s) => s.stores);
  const [busy, setBusy] = useState(false);
  const valid = /^[A-Za-z0-9_-]{32,128}$/.test(pairKey);
  return (
    <div>
      <PageHeader title="Connect this phone" back="#/settings" />
      <div className="p-3 space-y-3">
        <Card className="p-4 text-[15px] space-y-2">
          {!valid ? (
            <p className="text-red-700">This pairing link is not complete. Create a new one on your other phone (Settings → Cloud sync → Add another phone).</p>
          ) : (
            <>
              <p>
                This phone will be connected to your cloud data: stores, orders, carts, prices and weekly reports from your other phone(s) will appear here, and changes will sync both ways.
              </p>
              <p className="text-amber-800">
                <b>This phone’s current data is replaced by the cloud data.</b>
                {stores.length > 0 && ` It has ${stores.length} store(s) of its own.`} A safety copy is kept (Settings → Backup & restore → snapshots).
              </p>
            </>
          )}
        </Card>
        {valid && (
          <button
            type="button"
            className={`${btnPrimary} w-full`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await pairWithKey(pairKey);
                toast('This phone is connected to your cloud data');
                history.replaceState(null, '', location.pathname + location.search + '#/products'); // keep the key out of history
                go('products');
              } catch (e) {
                toast((e as Error).message, 'err');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Connecting…' : 'Connect this phone'}
          </button>
        )}
        <button type="button" className={`${btnSecondary} w-full`} onClick={() => go('settings')}>
          Cancel
        </button>
      </div>
    </div>
  );
}

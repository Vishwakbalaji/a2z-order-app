import { useEffect, useState } from 'react';
import { Badge, Card, Field, Icon, btnDanger, btnPrimary, btnSecondary, confirmDialog, inputCls, toast } from './ui';
import { disableOnThisPhone, enableAsFirstPhone, getKey, pairingLink, rotateKey, syncNow, syncUrl, useSyncStatus } from '../sync/client';
import { canShareFiles } from '../lib/download';
import { go } from '../lib/router';

export function CloudSyncCard() {
  const st = useSyncStatus();
  const [key, setKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [needsPair, setNeedsPair] = useState(false);
  useEffect(() => {
    getKey().then(setKey);
  }, [st.enabled]);

  if (!syncUrl()) {
    return (
      <Card className="p-4 text-sm text-gray-600">
        <h2 className="font-bold text-gray-900 mb-1">Cloud sync</h2>
        Not set up yet in this version of the app.
      </Card>
    );
  }

  const share = async () => {
    if (!key) return;
    const link = pairingLink(key);
    try {
      if (canShareFiles() && navigator.share) await navigator.share({ title: 'Connect my other phone', text: link });
      else {
        await navigator.clipboard.writeText(link);
        toast('Pairing link copied');
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <Card className="p-4" data-testid="cloud-sync">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="font-bold flex-1">Cloud sync</h2>
        {st.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}
      </div>
      {!st.enabled ? (
        <>
          <p className="text-sm text-gray-600 mb-3">
            Saves your stores, orders, carts, prices and reports in your private cloud (Cloudflare), keeps your phones in sync, and lets the cloud finalize the weekly report every Friday night even when your phone is off. No login: a private key is stored only on your phones.
          </p>
          {!needsPair ? (
            <button
              type="button"
              className={`${btnPrimary} w-full`}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await enableAsFirstPhone();
                  if (r.ok) toast('Cloud sync is on — your data is being uploaded');
                  else setNeedsPair(true);
                } catch (e) {
                  toast((e as Error).message, 'err');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="upload" /> Turn on cloud sync
            </button>
          ) : (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-sm text-amber-900 mb-2">
              Your cloud is already set up from another phone. On that phone open <b>Settings → Cloud sync → Add another phone</b> and open the link here — or paste your sync key below.
            </div>
          )}
          <details className="mt-3 text-sm" open={needsPair}>
            <summary className="text-brand font-semibold cursor-pointer">I have a sync key</summary>
            <Field label="Sync key">
              <input className={inputCls} value={manualKey} onChange={(e) => setManualKey(e.target.value.trim())} autoComplete="off" spellCheck={false} name="syncKey" />
            </Field>
            <button type="button" className={`${btnSecondary} w-full`} disabled={manualKey.length < 32} onClick={() => go(`pair/${manualKey}`)}>
              Connect this phone
            </button>
          </details>
        </>
      ) : (
        <>
          <div className="text-sm text-gray-700 space-y-1 mb-3" data-testid="sync-status">
            <div>
              {st.syncing ? 'Syncing…' : st.lastSyncAt ? `Last synced ${new Date(st.lastSyncAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Not synced yet'}
              {st.pending > 0 && ` · ${st.pending} change(s) waiting to upload`}
            </div>
            {st.error && <div className="text-amber-800">{st.error}</div>}
          </div>
          <div className="space-y-2">
            <button type="button" className={`${btnSecondary} w-full`} disabled={st.syncing} onClick={() => void syncNow()}>
              Sync now
            </button>
            <button type="button" className={`${btnPrimary} w-full`} onClick={share}>
              <Icon name="share" /> Add another phone
            </button>
            <p className="text-xs text-gray-500">Send the link to your other phone (e.g. by message to yourself) and open it there in Chrome. Anyone with this link can see your data — only send it to yourself.</p>
          </div>
          <details className="mt-3 text-sm">
            <summary className="font-semibold cursor-pointer">Your sync key (save it somewhere safe)</summary>
            <p className="text-gray-600 mt-1">If this phone is lost or its data is cleared, this key reconnects a new phone to your cloud data. Keep it in a password manager or a private note.</p>
            <div className="mt-2 p-2 rounded-lg bg-gray-100 font-mono text-xs break-all" data-testid="sync-key">
              {showKey ? key : '•'.repeat(24)}
            </div>
            <div className="flex gap-2 mt-2">
              <button type="button" className="text-brand font-semibold" onClick={() => setShowKey(!showKey)}>
                {showKey ? 'Hide' : 'Show'}
              </button>
              <button
                type="button"
                className="text-brand font-semibold"
                onClick={async () => {
                  if (!key) return;
                  await navigator.clipboard.writeText(key).catch(() => undefined);
                  toast('Key copied');
                }}
              >
                Copy
              </button>
            </div>
          </details>
          <details className="mt-3 text-sm">
            <summary className="font-semibold cursor-pointer">Advanced</summary>
            <div className="space-y-2 mt-2">
              <button
                type="button"
                className={`${btnSecondary} w-full`}
                onClick={async () => {
                  if (!(await confirmDialog('Change the sync key?', 'Use this if a phone was lost. All your OTHER phones will stop syncing until you pair them again with a new link.', 'Change key', true))) return;
                  try {
                    setKey(await rotateKey());
                    toast('New key saved on this phone. Pair your other phones again.');
                  } catch (e) {
                    toast((e as Error).message, 'err');
                  }
                }}
              >
                Change sync key
              </button>
              <button
                type="button"
                className={`${btnDanger} w-full`}
                onClick={async () => {
                  if (!(await confirmDialog('Turn off sync on this phone?', 'Your data stays on this phone and in the cloud. This phone just stops syncing. Save your sync key first if this is your only phone.', 'Turn off', true))) return;
                  await disableOnThisPhone();
                }}
              >
                Turn off sync on this phone
              </button>
            </div>
          </details>
        </>
      )}
    </Card>
  );
}

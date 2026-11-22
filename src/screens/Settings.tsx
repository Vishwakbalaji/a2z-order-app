import { useEffect, useRef, useState } from 'react';
import { Badge, Card, Field, Icon, PageHeader, btnPrimary, btnSecondary, inputCls, toast } from '../components/ui';
import { useApp, updateSettings } from '../state/store';
import { CloudSyncCard } from '../components/CloudSyncCard';

function resizeImage(file: File, max = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Not a readable image'));
    img.src = url;
  });
}

function LinkRow({ href, icon, title, sub, badge }: { href: string; icon: string; title: string; sub?: string; badge?: React.ReactNode }) {
  return (
    <a href={href} className="flex items-center gap-3 px-4 py-3 active:bg-gray-50 border-b border-gray-100 last:border-0">
      <Icon name={icon} className="w-5 h-5 text-brand shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold flex items-center gap-2">
          {title} {badge}
        </div>
        {sub && <div className="text-sm text-gray-500">{sub}</div>}
      </div>
      <Icon name="chevronRight" className="w-5 h-5 text-gray-400" />
    </a>
  );
}

export function SettingsScreen() {
  const settings = useApp((s) => s.settings);
  const reviewCount = useApp((s) => s.reviewCount);
  const products = useApp((s) => s.products);
  const priceItems = useApp((s) => s.priceItems);
  const [rep, setRep] = useState({ repName: settings.repName, repPhone: settings.repPhone });
  const [co, setCo] = useState({ companyName: settings.companyName, companyAddress: settings.companyAddress, companyPhone: settings.companyPhone });
  const [storage, setStorage] = useState<{ used: string; persisted: boolean | null }>({ used: '', persisted: null });
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    (async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        const persisted = (await navigator.storage?.persisted?.()) ?? null;
        setStorage({ used: est?.usage != null ? `${(est.usage / 1024 / 1024).toFixed(1)} MB` : '', persisted });
      } catch {
        /* ignore */
      }
    })();
  }, []);
  const unmatched = products.filter((p) => p.active && p.origin !== 'pricesheet' && p.matchStatus === 'unmatched').length;
  const catalogCount = products.filter((p) => p.origin === 'catalog').length;

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="p-3 space-y-4">
        <Card className="p-4">
          <h2 className="font-bold mb-3">Sales Representative</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await updateSettings({ repName: rep.repName.trim() || 'Vishwak', repPhone: rep.repPhone.trim() });
              toast('Representative details saved');
            }}
          >
            <Field label="Your name (shown on PDFs)">
              <input className={inputCls} value={rep.repName} onChange={(e) => setRep({ ...rep, repName: e.target.value })} name="repName" />
            </Field>
            <Field label="Your phone number (shown on PDFs)">
              <input className={inputCls} value={rep.repPhone} onChange={(e) => setRep({ ...rep, repPhone: e.target.value })} type="tel" inputMode="tel" placeholder="Not set" name="repPhone" />
            </Field>
            <button type="submit" className={`${btnPrimary} w-full`}>
              Save
            </button>
          </form>
        </Card>

        <CloudSyncCard />

        <Card className="overflow-hidden">
          <h2 className="font-bold px-4 pt-4 pb-2">Products, Prices & Data</h2>
          <LinkRow href="#/settings/import-prices" icon="upload" title="Upload price sheet" sub={`${priceItems.length} price lines loaded · PDF or CSV`} />
          <LinkRow href="#/settings/import-catalog" icon="upload" title="Upload product catalog" sub={catalogCount ? `${catalogCount} catalog products` : 'Not uploaded yet · PDF or CSV'} />
          <LinkRow
            href="#/settings/review"
            icon="link"
            title="Review price matching"
            sub="Confirm catalog ↔ price sheet matches"
            badge={reviewCount + unmatched > 0 ? <Badge tone="amber">{reviewCount + unmatched}</Badge> : undefined}
          />
          <LinkRow href="#/settings/products" icon="edit" title="Products & prices" sub="Edit, add, disable products · change prices" />
          <LinkRow href="#/settings/images" icon="image" title="Manage product images" sub="Check, approve, replace or add product pictures" />
          <LinkRow href="#/settings/backup" icon="download" title="Backup & restore" sub="Save all data to a file · restore it on any phone" />
        </Card>

        <Card className="p-4">
          <h2 className="font-bold mb-3">Distributor (shown on PDFs)</h2>
          <div className="flex items-center gap-3 mb-3">
            <img src={settings.logoDataUrl || './logo.png'} alt="Logo" className="h-14 w-28 object-contain border border-gray-200 rounded-lg bg-white" />
            <div className="flex flex-col gap-1">
              <button type="button" className="text-brand font-semibold text-sm text-left" onClick={() => fileRef.current?.click()}>
                Change logo
              </button>
              {settings.logoDataUrl && (
                <button type="button" className="text-gray-600 text-sm text-left" onClick={() => updateSettings({ logoDataUrl: null })}>
                  Use original A2Z logo
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  await updateSettings({ logoDataUrl: await resizeImage(f) });
                  toast('Logo updated');
                } catch (err) {
                  toast((err as Error).message, 'err');
                }
              }}
            />
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await updateSettings({ companyName: co.companyName.trim(), companyAddress: co.companyAddress.trim(), companyPhone: co.companyPhone.trim() });
              toast('Distributor details saved');
            }}
          >
            <Field label="Company name">
              <input className={inputCls} value={co.companyName} onChange={(e) => setCo({ ...co, companyName: e.target.value })} />
            </Field>
            <Field label="Address">
              <input className={inputCls} value={co.companyAddress} onChange={(e) => setCo({ ...co, companyAddress: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className={inputCls} value={co.companyPhone} onChange={(e) => setCo({ ...co, companyPhone: e.target.value })} type="tel" />
            </Field>
            <button type="submit" className={`${btnSecondary} w-full`}>
              Save distributor details
            </button>
          </form>
        </Card>

        <Card className="p-4 text-sm text-gray-600 space-y-1">
          <h2 className="font-bold text-gray-900 mb-1">About this app</h2>
          <p>All data is stored on this phone (IndexedDB){storage.used ? ` — using ${storage.used}` : ''}.</p>
          {storage.persisted === false && <p className="text-amber-800">The browser has not granted permanent storage. Installing the app to your home screen helps. Keep regular backups.</p>}
          {storage.persisted === true && <p className="text-green-700">Permanent storage granted by the browser.</p>}
          <p>Works offline after the first visit. Make a backup regularly (Settings → Backup & restore).</p>
          <p className="text-gray-400">Version {__APP_VERSION__}</p>
        </Card>
        <div className="h-4" />
      </div>
    </div>
  );
}

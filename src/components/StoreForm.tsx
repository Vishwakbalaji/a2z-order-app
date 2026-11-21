import { useState } from 'react';
import { Field, inputCls, btnPrimary, btnSecondary } from './ui';
import type { Store } from '../types';
import { formatNy } from '../lib/week';

export interface StoreInput {
  id?: string;
  name: string;
  address: string;
  phone: string;
  manager: string;
  isNew?: boolean;
}

export function StoreForm({ store, onSave, onCancel }: { store?: Store; onSave: (s: StoreInput) => Promise<void> | void; onCancel?: () => void }) {
  const creating = !store;
  const [v, setV] = useState<StoreInput>({
    id: store?.id,
    name: store?.name || '',
    address: store?.address || '',
    phone: store?.phone || '',
    manager: store?.manager || '',
    isNew: creating ? true : !!store?.isNew, // "Mark as New Store" is on by default for a new store
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const up = (k: keyof StoreInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const pending = !!store?.isNew && !store.firstOrderId;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.name.trim()) return setErr('Store name is required.');
        if (!v.address.trim()) return setErr('Store address is required.');
        setBusy(true);
        try {
          await onSave(v);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Store Name *">
        <input className={inputCls} value={v.name} onChange={up('name')} autoComplete="off" name="storeName" />
      </Field>
      <Field label="Store Address *">
        <textarea className={`${inputCls} h-auto py-2`} rows={2} value={v.address} onChange={up('address')} name="storeAddress" />
      </Field>
      <Field label="Store Phone Number">
        <input className={inputCls} value={v.phone} onChange={up('phone')} type="tel" inputMode="tel" name="storePhone" />
      </Field>
      <Field label="Store Manager / Contact Person">
        <input className={inputCls} value={v.manager} onChange={up('manager')} name="storeManager" />
      </Field>

      {creating ? (
        <label className="flex items-start gap-3 p-3 mb-3 rounded-xl border border-gray-200 bg-gray-50">
          <input type="checkbox" className="w-6 h-6 mt-0.5 accent-brand" checked={!!v.isNew} onChange={(e) => setV({ ...v, isNew: e.target.checked })} name="markNew" aria-label="Mark as New Store" />
          <span>
            <span className="block font-semibold">Mark as New Store</span>
            <span className="block text-sm text-gray-600">A store you just acquired. Its first finalized order PDF shows "NEW STORE — FIRST ORDER", and it counts as a new store in your weekly report. Untick for a store you already serve.</span>
          </span>
        </label>
      ) : (
        <div className="p-3 mb-3 rounded-xl border border-gray-200 bg-gray-50 text-sm">
          <div>
            <span className="text-gray-500">Date added: </span>
            <b>{formatNy(store!.createdAt, { month: 'long', day: 'numeric', year: 'numeric' })}</b>
          </div>
          {store!.isNew ? (
            store!.firstOrderId ? (
              <div className="mt-1">
                New store — first order finalized on <b>{formatNy(store!.firstOrderAt || 0)}</b>. Later orders do not show the label.
              </div>
            ) : (
              <label className="flex items-center gap-2 mt-1">
                <input type="checkbox" className="w-5 h-5 accent-brand" checked={!!v.isNew} onChange={(e) => setV({ ...v, isNew: e.target.checked })} name="markNew" />
                <span>New store — first order not placed yet{!v.isNew && pending ? ' (will be unmarked)' : ''}</span>
              </label>
            )
          ) : (
            <div className="mt-1 text-gray-600">Not marked as a new store. (Only possible when adding a store.)</div>
          )}
        </div>
      )}

      {err && <p className="text-red-600 text-sm mb-3">{err}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <button type="button" className={`${btnSecondary} flex-1`} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={busy} className={`${btnPrimary} flex-1`}>
          Save Store
        </button>
      </div>
    </form>
  );
}

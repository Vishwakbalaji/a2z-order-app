import { useState } from 'react';
import { Field, inputCls, btnPrimary, btnSecondary } from './ui';
import type { Store } from '../types';

export interface StoreInput {
  id?: string;
  name: string;
  address: string;
  phone: string;
  manager: string;
}

export function StoreForm({ store, onSave, onCancel }: { store?: Store; onSave: (s: StoreInput) => Promise<void> | void; onCancel?: () => void }) {
  const [v, setV] = useState<StoreInput>({ id: store?.id, name: store?.name || '', address: store?.address || '', phone: store?.phone || '', manager: store?.manager || '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const up = (k: keyof StoreInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
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

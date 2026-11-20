import { useState, useSyncExternalStore } from 'react';
import { Icon, Sheet, inputCls, btnPrimary, toast } from './ui';
import { StoreForm } from './StoreForm';
import { useApp, selectStore, saveStore } from '../state/store';
import type { Store } from '../types';

let req: { message?: string; resolve: (id: string | null) => void } | null = null;
const ls = new Set<() => void>();
const emit = () => ls.forEach((l) => l());

/** Opens the store picker; resolves with the selected store id (or null if cancelled). */
export function pickStore(message?: string): Promise<string | null> {
  return new Promise((resolve) => {
    req = { message, resolve };
    emit();
  });
}

export function StorePickerHost() {
  const r = useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => req,
  );
  const stores = useApp((s) => s.stores);
  const drafts = useApp((s) => s.drafts);
  const selected = useApp((s) => s.settings.selectedStoreId);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  if (!r) return null;
  const close = (id: string | null) => {
    req = null;
    setQ('');
    setAdding(false);
    emit();
    r.resolve(id);
  };
  const choose = async (s: Store) => {
    await selectStore(s.id);
    close(s.id);
  };
  const active = stores.filter((s) => !s.archived);
  const ql = q.trim().toLowerCase();
  const list = ql ? active.filter((s) => `${s.name} ${s.address} ${s.manager} ${s.phone}`.toLowerCase().includes(ql)) : active;
  return (
    <Sheet open onClose={() => close(null)} title={adding ? 'Add New Store' : 'Select Store'}>
      {adding ? (
        <StoreForm
          onCancel={() => setAdding(false)}
          onSave={async (data) => {
            const s = await saveStore(data);
            await selectStore(s.id);
            toast(`Store added: ${s.name}`);
            close(s.id);
          }}
        />
      ) : (
        <>
          {r.message && <p className="mb-3 text-[15px] text-gray-700">{r.message}</p>}
          <button type="button" className={`${btnPrimary} w-full mb-3`} onClick={() => setAdding(true)}>
            <Icon name="plus" /> Add New Store
          </button>
          {active.length > 5 && (
            <input className={`${inputCls} mb-3`} placeholder="Search stores" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
          )}
          {!active.length && <p className="text-gray-500 text-center py-6">No stores yet. Add your first store.</p>}
          <ul className="divide-y divide-gray-100">
            {list.map((s) => {
              const n = (drafts.get(s.id) || []).length;
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => choose(s)} className="w-full text-left py-3 flex items-center gap-3 active:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{s.name}</div>
                      <div className="text-sm text-gray-500 truncate">{s.address}</div>
                    </div>
                    {n > 0 && <span className="text-xs font-semibold bg-amber-100 text-amber-900 rounded-full px-2 py-0.5">{n} in draft</span>}
                    {selected === s.id && <Icon name="check" className="w-5 h-5 text-brand" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}

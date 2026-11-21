import { useState } from 'react';
import { Badge, Card, Empty, Icon, PageHeader, btnDanger, btnPrimary, btnSecondary, confirmDialog, toast } from '../components/ui';
import { StoreForm } from '../components/StoreForm';
import { useApp, saveStore, selectStore, archiveStore, deleteStore } from '../state/store';
import { go } from '../lib/router';

export function StoresScreen() {
  const stores = useApp((s) => s.stores);
  const drafts = useApp((s) => s.drafts);
  const selected = useApp((s) => s.settings.selectedStoreId);
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const ql = q.trim().toLowerCase();
  const list = stores.filter((s) => (showArchived ? s.archived : !s.archived) && (!ql || `${s.name} ${s.address} ${s.manager} ${s.phone}`.toLowerCase().includes(ql)));
  const archivedCount = stores.filter((s) => s.archived).length;
  return (
    <div>
      <PageHeader title="Stores" />
      <div className="p-3 space-y-3">
        <button type="button" className={`${btnPrimary} w-full`} onClick={() => go('stores/new')}>
          <Icon name="plus" /> Add New Store
        </button>
        {stores.length > 0 && <input type="search" placeholder="Search stores" value={q} onChange={(e) => setQ(e.target.value)} className="w-full h-11 px-3 rounded-xl border border-gray-300 bg-white" aria-label="Search stores" />}
        {!stores.length && (
          <Empty title="No stores yet">
            <p>Add the stores you visit. Each store keeps its own draft order.</p>
          </Empty>
        )}
        <ul className="space-y-2">
          {list.map((s) => {
            const n = (drafts.get(s.id) || []).length;
            return (
              <li key={s.id}>
                <Card className={`p-3 ${selected === s.id ? 'ring-2 ring-brand' : ''}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold flex items-center gap-2 flex-wrap">
                        {s.name}
                        {selected === s.id && <Badge tone="blue">Selected</Badge>}
                        {n > 0 && <Badge tone="amber">{n} in draft</Badge>}
                        {s.isNew && !s.firstOrderId && <Badge tone="green">NEW · first order pending</Badge>}
                        {s.isNew && s.firstOrderId && <Badge tone="gray">New store · ordered</Badge>}
                      </div>
                      <div className="text-sm text-gray-600">{s.address}</div>
                      {(s.manager || s.phone) && <div className="text-sm text-gray-500">{[s.manager, s.phone].filter(Boolean).join(' · ')}</div>}
                    </div>
                    <a href={`#/stores/${s.id}`} aria-label={`Edit ${s.name}`} className="w-10 h-10 flex items-center justify-center text-gray-500">
                      <Icon name="edit" />
                    </a>
                  </div>
                  {!s.archived && (
                    <button
                      type="button"
                      className={`${selected === s.id ? btnSecondary : btnPrimary} w-full mt-2 h-11`}
                      onClick={async () => {
                        await selectStore(s.id);
                        go('products');
                      }}
                    >
                      {selected === s.id ? 'Continue order' : 'Select & start order'}
                    </button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
        {archivedCount > 0 && (
          <button type="button" className="text-sm text-brand font-semibold w-full py-2" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Show active stores' : `Show archived stores (${archivedCount})`}
          </button>
        )}
      </div>
    </div>
  );
}

export function StoreEditScreen({ id }: { id: string }) {
  const stores = useApp((s) => s.stores);
  const store = id === 'new' ? undefined : stores.find((s) => s.id === id);
  if (id !== 'new' && !store) return <><PageHeader title="Store" back="#/stores" /><Empty title="Store not found" /></>;
  return (
    <div>
      <PageHeader title={store ? 'Edit Store' : 'Add New Store'} back="#/stores" />
      <div className="p-3">
        <Card className="p-4">
          <StoreForm
            store={store}
            onCancel={() => go('stores')}
            onSave={async (v) => {
              const s = await saveStore(v);
              if (!store) await selectStore(s.id);
              toast(store ? 'Store saved' : `Store added and selected: ${s.name}`);
              go('stores');
            }}
          />
        </Card>
        {store && (
          <div className="space-y-2 mt-4">
            <button
              type="button"
              className={`${btnSecondary} w-full`}
              onClick={async () => {
                const ok = await confirmDialog(store.archived ? 'Restore store?' : 'Archive store?', store.archived ? 'The store will be available again.' : 'The store is hidden from the store list. Its draft and order history are kept.', store.archived ? 'Restore' : 'Archive');
                if (!ok) return;
                await archiveStore(store.id, !store.archived);
                toast(store.archived ? 'Store restored' : 'Store archived');
                go('stores');
              }}
            >
              {store.archived ? 'Restore store' : 'Archive store'}
            </button>
            <button
              type="button"
              className={`${btnDanger} w-full`}
              onClick={async () => {
                const ok = await confirmDialog('Delete store permanently?', `Deletes "${store.name}" and its draft cart. Completed orders in Order History are kept. This cannot be undone (except by restoring a backup).`, 'Delete', true);
                if (!ok) return;
                await deleteStore(store.id);
                toast('Store deleted');
                go('stores');
              }}
            >
              <Icon name="trash" /> Delete store
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import { Icon } from './ui';
import { pickStore } from './StorePicker';
import { useApp } from '../state/store';

export function TopBar() {
  const settings = useApp((s) => s.settings);
  const stores = useApp((s) => s.stores);
  const store = stores.find((s) => s.id === settings.selectedStoreId);
  return (
    <div className="bg-white px-3 pt-2 pb-2 border-b border-gray-200">
      <div className="flex items-center gap-2">
        <img src={settings.logoDataUrl || './logo.png'} alt="" className="h-8 w-auto max-w-[72px] object-contain" />
        <div className="text-[15px] font-bold text-brand leading-tight truncate flex-1">{settings.companyName || 'Order Pad'}</div>
      </div>
      <button
        type="button"
        onClick={() => pickStore()}
        data-testid="store-selector"
        className={`mt-2 w-full h-11 rounded-xl border flex items-center gap-2 px-3 text-left ${store ? 'border-gray-300 bg-gray-50' : 'border-amber-400 bg-amber-50'}`}
      >
        <Icon name="store" className="w-5 h-5 text-gray-500 shrink-0" />
        <span className="flex-1 min-w-0 truncate">
          {store ? (
            <>
              <span className="text-gray-500 text-sm">Store: </span>
              <span className="font-semibold">{store.name}</span>
            </>
          ) : (
            <span className="font-semibold text-amber-900">Select a store</span>
          )}
        </span>
        <Icon name="chevronDown" className="w-5 h-5 text-gray-500 shrink-0" />
      </button>
    </div>
  );
}

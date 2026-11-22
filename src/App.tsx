import { useEffect, useRef } from 'react';
import { useRoute } from './lib/router';
import { useApp, currentLines, cartTotals } from './state/store';
import { DialogHost, Icon, ToastHost } from './components/ui';
import { StorePickerHost } from './components/StorePicker';
import { ProductsScreen } from './screens/Products';
import { CartScreen } from './screens/Cart';
import { OrdersScreen, OrderDetailScreen } from './screens/Orders';
import { StoresScreen, StoreEditScreen } from './screens/Stores';
import { SettingsScreen } from './screens/Settings';
import { ImportPricesScreen } from './screens/admin/ImportPrices';
import { ImportCatalogScreen } from './screens/admin/ImportCatalog';
import { PriceStatusScreen } from './screens/admin/PriceStatus';
import { ReviewMatchesScreen } from './screens/admin/ReviewMatches';
import { ManageProductsScreen, ProductEditScreen } from './screens/admin/ManageProducts';
import { BackupScreen } from './screens/admin/Backup';
import { WeeklyReportsScreen, WeeklyReportScreen } from './screens/WeeklyReports';
import { PairScreen } from './screens/Pair';

function BottomNav({ tab }: { tab: string }) {
  const drafts = useApp((s) => s.drafts);
  const storeId = useApp((s) => s.settings.selectedStoreId);
  const reviewCount = useApp((s) => s.reviewCount);
  void drafts;
  void storeId;
  const t = cartTotals(currentLines());
  const items: [string, string, string, number?][] = [
    ['products', 'Products', 'box'],
    ['cart', 'Cart', 'cart', t.cases],
    ['orders', 'Orders', 'history'],
    ['stores', 'Stores', 'store'],
    ['settings', 'Settings', 'settings', reviewCount],
  ];
  return (
    <nav className="shrink-0 bg-white border-t border-gray-200 pb-safe z-30" aria-label="Main">
      <ul className="flex">
        {items.map(([key, label, icon, badge]) => {
          const active = tab === key;
          return (
            <li key={key} className="flex-1">
              <a href={`#/${key}`} aria-current={active ? 'page' : undefined} data-testid={`nav-${key}`} className={`relative flex flex-col items-center justify-center h-16 text-xs font-semibold ${active ? 'text-brand' : 'text-gray-500'}`}>
                <span className="relative">
                  <Icon name={icon} className="w-6 h-6" strokeWidth={active ? 2.4 : 2} />
                  {!!badge && badge > 0 && (
                    <span
                      className={`absolute -top-2 -right-3 min-w-5 h-5 px-1 rounded-full text-[11px] leading-5 text-center text-white ${key === 'cart' ? 'bg-accent' : 'bg-amber-500'}`}
                      data-testid={key === 'cart' ? 'cart-badge' : undefined}
                      aria-label={key === 'cart' ? `${badge} cases in cart` : `${badge} to review`}
                    >
                      {badge > 999 ? '999+' : badge}
                    </span>
                  )}
                </span>
                <span className="mt-0.5">{label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function App() {
  const ready = useApp((s) => s.ready);
  const error = useApp((s) => s.error);
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);
  const [tab, sub, sub2] = route;
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [tab, sub, sub2]);

  let screen: React.ReactNode;
  if (!ready) screen = <div className="p-10 text-center text-gray-500">Loading…</div>;
  else if (tab === 'cart') screen = <CartScreen />;
  else if (tab === 'orders') screen = sub ? <OrderDetailScreen id={sub} /> : <OrdersScreen />;
  else if (tab === 'pair') screen = <PairScreen pairKey={sub || ''} />;
  else if (tab === 'reports') screen = sub ? <WeeklyReportScreen key={sub} id={sub} /> : <WeeklyReportsScreen />;
  else if (tab === 'stores') screen = sub ? <StoreEditScreen id={sub} /> : <StoresScreen />;
  else if (tab === 'settings') {
    if (sub === 'import-prices') screen = <ImportPricesScreen />;
    else if (sub === 'import-catalog') screen = <ImportCatalogScreen />;
    else if (sub === 'review') screen = <ReviewMatchesScreen />;
    else if (sub === 'prices') screen = <PriceStatusScreen />;
    else if (sub === 'products') screen = sub2 ? <ProductEditScreen key={sub2} id={sub2} /> : <ManageProductsScreen />;
    else if (sub === 'backup') screen = <BackupScreen />;
    else screen = <SettingsScreen />;
  } else screen = <ProductsScreen />;

  return (
    <div className="h-[100dvh] flex flex-col max-w-2xl mx-auto bg-gray-50 sm:border-x sm:border-gray-200">
      {error && (
        <div className="bg-red-600 text-white text-sm px-3 py-2" role="alert">
          {error}
        </div>
      )}
      <main ref={mainRef} className="flex-1 overflow-y-auto overscroll-contain" id="main">
        {screen}
      </main>
      <BottomNav tab={tab === 'reports' ? 'orders' : tab === 'pair' ? 'settings' : ['cart', 'orders', 'stores', 'settings'].includes(tab) ? tab : 'products'} />
      <StorePickerHost />
      <DialogHost />
      <ToastHost />
    </div>
  );
}

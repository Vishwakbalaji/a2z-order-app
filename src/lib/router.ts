import { useSyncExternalStore } from 'react';

/** Tiny hash router: "#/cart", "#/stores/abc" ... (works on any static host, back button works). */
function current(): string[] {
  const h = location.hash.replace(/^#\/?/, '');
  return h ? h.split('/').map(decodeURIComponent) : ['products'];
}
let cached = current();
let cachedHash = location.hash;
function sub(l: () => void) {
  window.addEventListener('hashchange', l);
  return () => window.removeEventListener('hashchange', l);
}
export function useRoute(): string[] {
  return useSyncExternalStore(sub, () => {
    if (location.hash !== cachedHash) {
      cachedHash = location.hash;
      cached = current();
    }
    return cached;
  });
}
export function go(path: string) {
  location.hash = path.startsWith('#') ? path : '#/' + path.replace(/^\//, '');
}

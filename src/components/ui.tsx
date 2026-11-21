import { memo, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

/* ------------------------------ icons ------------------------------ */
const paths: Record<string, string> = {
  box: 'M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8',
  cart: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2M10 20.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0Zm8 0a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0Z',
  store: 'M4 10v10h16V10M3 10l2-6h14l2 6M3 10c0 1.7 1.3 3 3 3s3-1.3 3-3m0 0c0 1.7 1.3 3 3 3s3-1.3 3-3m0 0c0 1.7 1.3 3 3 3s3-1.3 3-3M10 20v-5h4v5',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  search: 'm21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 18 6-6-6-6',
  back: 'M15 18l-6-6 6-6',
  download: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  share: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  trash: 'M3 6h18M8 6V4h8v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  upload: 'M12 21V9m0 0-4 4m4-4 4 4M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2',
  note: 'M4 4h16v12H8l-4 4V4Z',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1m2 5a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
};
export function Icon({ name, className = 'w-5 h-5', strokeWidth = 2 }: { name: keyof typeof paths | string; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

/* ------------------------------ stepper ------------------------------ */
export const Stepper = memo(function Stepper({
  qty,
  onDec,
  onInc,
  onTapQty,
  label,
}: {
  qty: number;
  onDec: () => void;
  onInc: () => void;
  onTapQty?: () => void;
  label: string;
}) {
  return (
    <div className="flex items-center shrink-0 select-none">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={onDec}
        disabled={qty <= 0}
        className="w-11 h-11 rounded-full border border-gray-300 bg-white text-gray-800 flex items-center justify-center active:bg-gray-100 disabled:opacity-35"
      >
        <Icon name="minus" className="w-5 h-5" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        onClick={onTapQty}
        aria-label={`Quantity of ${label}`}
        data-testid="qty"
        className={`min-w-[2.75rem] h-11 px-1 text-center text-lg font-bold tabular-nums ${qty > 0 ? 'text-brand' : 'text-gray-400'}`}
      >
        {qty}
      </button>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={onInc}
        className="w-11 h-11 rounded-full bg-brand text-white flex items-center justify-center active:bg-brand-dark"
      >
        <Icon name="plus" className="w-5 h-5" strokeWidth={2.5} />
      </button>
    </div>
  );
});

/* ------------------------------ sheet ------------------------------ */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col shadow-xl pb-safe">
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-100">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-10 h-10 -mr-2 flex items-center justify-center text-gray-500">
            <Icon name="x" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3 flex-1">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-gray-100">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------ dialogs (promise based) ------------------------------ */
type DialogReq =
  | { kind: 'confirm'; title: string; message: ReactNode; okText: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; message?: ReactNode; value: string; inputMode?: 'numeric' | 'decimal' | 'text'; okText: string; resolve: (v: string | null) => void };
let dialog: DialogReq | null = null;
const dlgListeners = new Set<() => void>();
function setDialog(d: DialogReq | null) {
  dialog = d;
  dlgListeners.forEach((l) => l());
}
export function confirmDialog(title: string, message: ReactNode, okText = 'OK', danger = false): Promise<boolean> {
  return new Promise((resolve) => setDialog({ kind: 'confirm', title, message, okText, danger, resolve }));
}
export function promptDialog(title: string, value = '', opts: { message?: ReactNode; inputMode?: 'numeric' | 'decimal' | 'text'; okText?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => setDialog({ kind: 'prompt', title, value, message: opts.message, inputMode: opts.inputMode, okText: opts.okText || 'OK', resolve }));
}
export function DialogHost() {
  const d = useSyncExternalStore(
    (l) => {
      dlgListeners.add(l);
      return () => dlgListeners.delete(l);
    },
    () => dialog,
  );
  const [val, setVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (d?.kind === 'prompt') {
      setVal(d.value);
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [d]);
  if (!d) return null;
  const close = (v: unknown) => {
    setDialog(null);
    (d.resolve as (x: unknown) => void)(v);
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-label={d.title}>
      <div className="absolute inset-0 bg-black/40" onClick={() => close(d.kind === 'confirm' ? false : null)} />
      <form
        className="relative w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          close(d.kind === 'confirm' ? true : val);
        }}
      >
        <h2 className="text-lg font-semibold mb-2">{d.title}</h2>
        {d.message && <div className="text-gray-600 text-[15px] mb-3">{d.message}</div>}
        {d.kind === 'prompt' && (
          <input
            ref={inputRef}
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            inputMode={d.inputMode}
            className="w-full border border-gray-300 rounded-xl px-3 h-12 text-lg mb-3 focus:outline-none focus:ring-2 focus:ring-brand"
          />
        )}
        <div className="flex gap-2 justify-end">
          <button type="button" className="h-11 px-4 rounded-xl text-gray-700 font-medium" onClick={() => close(d.kind === 'confirm' ? false : null)}>
            Cancel
          </button>
          <button type="submit" className={`h-11 px-5 rounded-xl text-white font-semibold ${d.kind === 'confirm' && d.danger ? 'bg-red-600' : 'bg-brand'}`}>
            {d.okText}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------ toast ------------------------------ */
let toastMsg: { id: number; text: string; tone: 'ok' | 'err' } | null = null;
const toastListeners = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, tone: 'ok' | 'err' = 'ok') {
  toastMsg = { id: Date.now(), text, tone };
  toastListeners.forEach((l) => l());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMsg = null;
    toastListeners.forEach((l) => l());
  }, tone === 'err' ? 6000 : 2600);
}
export function ToastHost() {
  const t = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toastMsg,
  );
  if (!t) return null;
  return (
    <div className="fixed left-0 right-0 top-2 z-[70] flex justify-center px-4 pointer-events-none" style={{ paddingTop: 'env(safe-area-inset-top)' }} role="status">
      <div className={`max-w-md px-4 py-3 rounded-xl shadow-lg text-[15px] text-white ${t.tone === 'err' ? 'bg-red-600' : 'bg-gray-900'}`}>{t.text}</div>
    </div>
  );
}

/* ------------------------------ small pieces ------------------------------ */
export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children'>) {
  return (
    <div {...rest} className={`bg-white rounded-2xl border border-gray-200 ${className}`}>
      {children}
    </div>
  );
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}
export const inputCls = 'w-full border border-gray-300 rounded-xl px-3 h-12 bg-white focus:outline-none focus:ring-2 focus:ring-brand';
export const btnPrimary = 'h-12 px-4 rounded-xl bg-brand text-white font-semibold active:bg-brand-dark disabled:opacity-40 flex items-center justify-center gap-2';
export const btnSecondary = 'h-12 px-4 rounded-xl bg-white border border-gray-300 text-gray-800 font-semibold active:bg-gray-100 disabled:opacity-40 flex items-center justify-center gap-2';
export const btnDanger = 'h-12 px-4 rounded-xl bg-white border border-red-300 text-red-700 font-semibold active:bg-red-50 flex items-center justify-center gap-2';

export function Badge({ tone = 'gray', children }: { tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue'; children: ReactNode }) {
  const c = { gray: 'bg-gray-100 text-gray-700', green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-900', red: 'bg-red-100 text-red-800', blue: 'bg-brand-light text-brand' }[tone];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${c}`}>{children}</span>;
}

export function PageHeader({ title, back, right }: { title: string; back?: string; right?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-2 h-14 flex items-center gap-1">
      {back && (
        <a href={back} aria-label="Back" className="w-11 h-11 flex items-center justify-center text-gray-700">
          <Icon name="back" className="w-6 h-6" />
        </a>
      )}
      <h1 className={`text-lg font-semibold flex-1 truncate ${back ? '' : 'pl-2'}`}>{title}</h1>
      {right}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="text-center py-14 px-6 text-gray-500">
      <p className="font-semibold text-gray-700 text-lg mb-1">{title}</p>
      {children}
    </div>
  );
}

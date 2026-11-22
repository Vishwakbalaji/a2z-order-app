import { formatCents } from '../lib/money';
import type { PriceInfo } from '../lib/products';

/**
 * Case price with its status, in color AND words (so it is clear without color too):
 *   confirmed → green "$14.99 / case · Confirmed", approximate → orange "… · Approximate",
 *   needs a choice/review → gray "Needs price selection" / "Needs review", missing → gray "Price Not Listed".
 */
export function PriceLabel({ info, perCase = '/ case', compact = false }: { info: PriceInfo; perCase?: string; compact?: boolean }) {
  if (info.cents != null && (info.status === 'confirmed' || info.status === 'approximate')) {
    const ok = info.status === 'confirmed';
    return (
      <span className={`tabular-nums ${ok ? 'text-green-700' : 'text-orange-600'}`} data-testid="price" data-status={info.status}>
        <span className="font-bold">{formatCents(info.cents)}</span>
        <span className="text-sm"> {perCase}</span>
        {!compact && <span className="text-sm font-semibold"> · {ok ? 'Confirmed' : 'Approximate'}</span>}
      </span>
    );
  }
  const text = info.status === 'review' ? (info.options?.length ? 'Needs price selection' : 'Needs review') : 'Price Not Listed';
  return (
    <span className="text-gray-500 font-semibold text-sm" data-testid="price" data-status={info.status}>
      {text}
    </span>
  );
}

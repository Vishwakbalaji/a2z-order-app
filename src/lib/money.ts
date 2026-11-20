/** All money is stored and summed as integer cents to avoid floating point errors. */

export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return parseInt(whole, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return fmt.format(cents / 100);
}

/** "12.50" style (no $) for editable inputs. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

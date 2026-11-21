/**
 * Reporting weeks: Saturday 00:00:00 → Friday 23:59:59.999, America/New_York (DST-aware,
 * using the browser's built-in time-zone data). An instant belongs to exactly one week:
 * startUtc <= t < endUtc, where endUtc is the next Saturday's midnight.
 */
export const REPORT_TZ = 'America/New_York';
/** Week 1 of the weekly reports (owner's schedule): Saturday, November 21, 2026. */
export const REPORT_START = '2026-11-21';

const DAY = 86_400_000;
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: REPORT_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function nyParts(ms: number) {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second, wd: WD[p.weekday] };
}

/** New York offset from UTC at this instant, in ms (e.g. -5h in winter, -4h in summer). */
function offsetAt(ms: number): number {
  const p = nyParts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of 00:00 New York time on the given calendar date. */
export function nyMidnightUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetAt(guess);
  const o2 = offsetAt(t);
  if (guess - o2 !== t) t = guess - o2;
  return t;
}

export function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY);
  return dateKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export function nyDateKey(ms: number): string {
  const p = nyParts(ms);
  return dateKey(p.y, p.m, p.d);
}

export interface Week {
  key: string; // Saturday
  start: string; // = key
  end: string; // Friday
  startUtc: number;
  endUtc: number; // exclusive
  number: number; // 1 = the week of REPORT_START
}

export function weekFromKey(key: string, reportStart = REPORT_START): Week {
  const next = addDaysKey(key, 7);
  const [y, m, d] = key.split('-').map(Number);
  const [y0, m0, d0] = reportStart.split('-').map(Number);
  const number = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y0, m0 - 1, d0)) / (7 * DAY)) + 1;
  return { key, start: key, end: addDaysKey(key, 6), startUtc: nyMidnightUtc(key), endUtc: nyMidnightUtc(next), number };
}

/** The reporting week that contains this instant. */
export function weekOf(ms: number, reportStart = REPORT_START): Week {
  const p = nyParts(ms);
  const back = (p.wd + 1) % 7; // Saturday → 0, Sunday → 1, … Friday → 6
  return weekFromKey(addDaysKey(dateKey(p.y, p.m, p.d), -back), reportStart);
}

/** All weeks from week 1 whose period has fully ended at `now`. */
export function closedWeeks(now: number, reportStart = REPORT_START): Week[] {
  const out: Week[] = [];
  for (let w = weekFromKey(reportStart, reportStart); w.endUtc <= now; w = weekFromKey(addDaysKey(w.key, 7), reportStart)) out.push(w);
  return out;
}

export function formatDay(key: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}
export function formatPeriod(w: { start: string; end: string }): string {
  const sameMonth = w.start.slice(0, 7) === w.end.slice(0, 7);
  return sameMonth ? `${formatDay(w.start)}–${Number(w.end.slice(8))}, ${w.end.slice(0, 4)}` : `${formatDay(w.start)} – ${formatDay(w.end)}, ${w.end.slice(0, 4)}`;
}
/** A finalized/creation time shown in New York time. */
export function formatNy(ms: number, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  return new Date(ms).toLocaleString('en-US', { ...opts, timeZone: REPORT_TZ });
}

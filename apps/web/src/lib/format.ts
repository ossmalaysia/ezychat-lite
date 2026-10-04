import { format, formatDistanceToNowStrict, isSameDay, isSameYear, isYesterday } from 'date-fns';
import { intlTag, isLocale } from '@wa-team-inbox/shared';
import { dateLocale } from '@/i18n/date-locale';
import { i18n } from '@/i18n';

// Formatting follows the active UI language. Components that render these values must use
// `useTranslation()` (or `useLocale()`) so they re-render when the language changes.

const tag = () => intlTag(isLocale(i18n.language) ? i18n.language : 'en');
const dateFormat = (ts: number | Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(tag(), options).format(ts);

/** Short list-style time: "14:05" today, "Yesterday", "3 Oct" this year, else "3 Oct 2025". */
export function formatListTime(ts: number | null | undefined, now: Date = new Date()): string {
  if (ts == null) return '';
  const d = new Date(ts);
  if (isSameDay(d, now)) return format(d, 'HH:mm');
  if (isYesterday(d)) return i18n.t('common:time.yesterday');
  if (isSameYear(d, now)) return dateFormat(d, { day: 'numeric', month: 'short' });
  return dateFormat(d, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTime(ts: number): string {
  return format(new Date(ts), 'HH:mm');
}

export function formatDateTime(ts: number): string {
  return `${dateFormat(ts, { day: 'numeric', month: 'short', year: 'numeric' })}, ${formatTime(ts)}`;
}

/** Day separator label: "Today", "Yesterday", or "Monday 3 October 2026". */
export function formatDay(ts: number, now: Date = new Date()): string {
  const d = new Date(ts);
  if (isSameDay(d, now)) return i18n.t('common:time.today');
  if (isYesterday(d)) return i18n.t('common:time.yesterday');
  return dateFormat(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** "5 minutes ago" in the active language. */
export function formatRelative(ts: number): string {
  return formatDistanceToNowStrict(new Date(ts), { addSuffix: true, locale: dateLocale() });
}

/** Number in the active UI language, e.g. "1,234" / "1.234". */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(tag(), options).format(n);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${formatNumber(n)} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v < 10 ? 1 : 0;
  return `${formatNumber(v, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[i]}`;
}

/** Up to two initials from a display name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

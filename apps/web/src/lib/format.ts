import { format, formatDistanceToNowStrict, isSameDay, isSameYear, isYesterday } from 'date-fns';

/** Short list-style time: "14:05" today, "Yesterday", "Mon 3 Oct" this year, else "3 Oct 2025". */
export function formatListTime(ts: number | null | undefined, now: Date = new Date()): string {
  if (ts == null) return '';
  const d = new Date(ts);
  if (isSameDay(d, now)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  if (isSameYear(d, now)) return format(d, 'd MMM');
  return format(d, 'd MMM yyyy');
}

export function formatTime(ts: number): string {
  return format(new Date(ts), 'HH:mm');
}

export function formatDateTime(ts: number): string {
  return format(new Date(ts), 'd MMM yyyy, HH:mm');
}

/** Day separator label: "Today", "Yesterday", or "Monday, 3 October 2026". */
export function formatDay(ts: number, now: Date = new Date()): string {
  const d = new Date(ts);
  if (isSameDay(d, now)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE, d MMMM yyyy');
}

export function formatRelative(ts: number): string {
  return formatDistanceToNowStrict(new Date(ts), { addSuffix: true });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
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

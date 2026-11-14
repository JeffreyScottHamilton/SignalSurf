import { stateName } from '@/catalog/genres';
import type { Station } from '@/types';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * "City, ST" when both are known, the state's full name, the city alone, or "United States" when no state
 * is known. Never guesses a state or city.
 */
export function stationLocation(s: Station): string {
  const name = stateName(s.stateCode);
  const city = typeof s.city === 'string' ? s.city.trim() : '';
  if (s.stateCode !== null && name !== null) return city ? `${city}, ${s.stateCode}` : name;
  if (city) return city;
  return 'United States';
}

/** The station homepage as a link target: http(s) only, otherwise null. */
export function externalHref(url: string | null | undefined): string | null {
  return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null;
}

/** Time such as "2:14 PM" when played today, otherwise a short date such as "Nov 12". */
export function formatPlayedAt(ms: number, now: number = Date.now()): string {
  if (startOfDay(ms) === startOfDay(now)) {
    return new Date(ms)
      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      .replace(/\u202f/g, ' ');
  }
  return formatDate(ms, now);
}

/** "Today", "Yesterday", or a short date (with year when it differs from now). */
export function dayLabel(ms: number, now: number = Date.now()): 'Today' | 'Yesterday' | string {
  const day = startOfDay(ms);
  const today = startOfDay(now);
  if (day === today) return 'Today';
  if (day === startOfDay(today - DAY_MS)) return 'Yesterday';
  return formatDate(ms, now);
}

function formatDate(ms: number, now: number): string {
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

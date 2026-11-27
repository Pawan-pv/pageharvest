/**
 * A short, human sentence for when something was collected. The Data view groups repeat
 * runs from the same page, so "2 hours ago" tells them apart better than the same date.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(timestamp: number, now: number = Date.now()): string {
  if (!Number.isFinite(timestamp)) return '';
  const elapsed = now - timestamp;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) {
    const minutes = Math.max(1, Math.floor(elapsed / MINUTE));
    return `${minutes} min ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.max(1, Math.floor(elapsed / HOUR));
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  if (elapsed < 7 * DAY) {
    const days = Math.max(1, Math.floor(elapsed / DAY));
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}

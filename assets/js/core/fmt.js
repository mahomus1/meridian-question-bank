/* Formatting helpers. Everything user-facing that needs consistent shape. */

export function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m % 60)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

export function duration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function secs(n) {
  if (n < 60) return `${n}s`;
  return `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, '0')}s`;
}

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function ago(ts) {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 6e4);
  if (min < 1) return 'just now';
  if (min < 60) return RTF.format(-min, 'minute');
  const hr = Math.round(min / 60);
  if (hr < 24) return RTF.format(-hr, 'hour');
  const day = Math.round(hr / 24);
  if (day < 30) return RTF.format(-day, 'day');
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const dateShort = (ts) => new Date(ts)
  .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const dateFull = (ts) => new Date(ts)
  .toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });

export const timeShort = (ts) => new Date(ts)
  .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export const n = (x) => Number(x).toLocaleString();
export const pct = (x) => `${Math.round(x)}%`;

export function plural(count, one, many) {
  return `${n(count)} ${count === 1 ? one : (many || `${one}s`)}`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Filename-safe stamp for exports. */
export function stamp() {
  const d = new Date();
  const two = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

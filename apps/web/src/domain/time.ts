/**
 * The units boundary. Seconds exist only here (audio.currentTime / duration_seconds
 * conversions) and in persistence/serverAdapter.ts. Everywhere else is integer ms.
 */

export function secToMs(s: number): number {
  return Math.round(s * 1000);
}

export function msToSec(ms: number): number {
  return ms / 1000;
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** "m:ss.mmm" */
export function formatMs(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${m}:${pad(s, 2)}.${pad(t % 1000, 3)}`;
}

/** "m:ss" (floored) */
export function formatShort(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  return `${Math.floor(t / 60000)}:${pad(Math.floor((t % 60000) / 1000), 2)}`;
}

/** Accepts "m:ss.mmm", "m:ss", "ss.mmm", "ss". Returns ms or null when unparseable. */
export function parseTime(str: string): number | null {
  const m = /^(?:(\d+):)?(\d+)(?:\.(\d{1,3}))?$/.exec(str.trim());
  if (!m) return null;
  const mins = m[1] !== undefined ? Number(m[1]) : null;
  const secs = Number(m[2]);
  if (mins !== null && secs >= 60) return null;
  const frac = m[3] !== undefined ? Number(m[3].padEnd(3, '0')) : 0;
  return (mins ?? 0) * 60000 + secs * 1000 + frac;
}

export function clampMs(ms: number, durationMs: number): number {
  return Math.min(Math.max(Math.round(ms), 0), Math.max(0, durationMs));
}

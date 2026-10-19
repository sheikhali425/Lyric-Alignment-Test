/**
 * Waveform peaks. Decode once per URL, reduce to min/max buckets at a fixed base resolution,
 * then downsample on demand for drawing at any zoom (peaksForRange).
 */

export const BUCKETS_PER_SEC = 200;
/** Decode at a low rate: peaks at 200/s only need ~100 samples per bucket, and memory halves versus 44.1k. */
const DECODE_RATE = 22050;

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
  bucketsPerSec: number;
  /** Decoded length in ms (from the audio data itself). */
  durationMs: number;
  /** Largest absolute value, for normalising the display. */
  absMax: number;
}

const cache = new Map<string, Promise<Peaks>>();

export function computePeaks(channels: Float32Array[], sampleRate: number): Peaks {
  const length = channels[0]?.length ?? 0;
  const perBucket = sampleRate / BUCKETS_PER_SEC;
  const n = Math.max(1, Math.ceil(length / perBucket));
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  let absMax = 0;
  const nc = channels.length || 1;
  for (let b = 0; b < n; b++) {
    const from = Math.floor(b * perBucket);
    const to = Math.min(length, Math.floor((b + 1) * perBucket));
    let lo = 0;
    let hi = 0;
    for (let i = from; i < to; i++) {
      let v = 0;
      for (let c = 0; c < nc; c++) v += channels[c][i];
      v /= nc;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
    absMax = Math.max(absMax, -lo, hi);
  }
  return { min, max, bucketsPerSec: BUCKETS_PER_SEC, durationMs: Math.round((length / sampleRate) * 1000), absMax };
}

async function decode(url: string): Promise<Peaks> {
  const start = `peaks-start:${url}`;
  performance.mark(start);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Audio request failed (${res.status})`);
  const data = await res.arrayBuffer();
  const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctx) throw new Error('Web Audio is not available');
  const ctx = new Ctx(1, 1, DECODE_RATE);
  const buf = await ctx.decodeAudioData(data);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
  const peaks = computePeaks(channels, buf.sampleRate);
  try {
    performance.measure('peaks', { start, detail: { url, buckets: peaks.min.length, bytes: data.byteLength } });
  } catch {
    /* measure is best effort */
  }
  return peaks;
}

/**
 * Cached per URL. A failed decode is evicted so a retry is possible.
 * Deliberately not abortable: the promise is shared, so one caller's abort (e.g. StrictMode's
 * mount/unmount/mount) must not poison it for the next. Callers ignore results they no longer want.
 */
export function decodePeaks(url: string): Promise<Peaks> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = decode(url);
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

export interface PeakColumns {
  min: Float32Array;
  max: Float32Array;
}

/** Downsample [startMs, endMs) to `columns` min/max pairs. Outside the audio the columns are 0. */
export function peaksForRange(peaks: Peaks, startMs: number, endMs: number, columns: number): PeakColumns {
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  const perMs = peaks.bucketsPerSec / 1000;
  const total = peaks.min.length;
  const span = (endMs - startMs) * perMs; // buckets across the range
  for (let c = 0; c < columns; c++) {
    const b0 = startMs * perMs + (c / columns) * span;
    const b1 = startMs * perMs + ((c + 1) / columns) * span;
    let i0 = Math.floor(b0);
    let i1 = Math.max(i0 + 1, Math.ceil(b1));
    if (i1 <= 0 || i0 >= total) continue;
    i0 = Math.max(0, i0);
    i1 = Math.min(total, i1);
    let lo = 0;
    let hi = 0;
    for (let i = i0; i < i1; i++) {
      if (peaks.min[i] < lo) lo = peaks.min[i];
      if (peaks.max[i] > hi) hi = peaks.max[i];
    }
    min[c] = lo;
    max[c] = hi;
  }
  return { min, max };
}

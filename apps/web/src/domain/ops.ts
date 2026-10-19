/**
 * Pure document operations. Doc in, Doc out; inputs are never mutated.
 * Every produced time is an integer in [0, durationMs] with endMs - startMs >= MIN_SEGMENT_MS
 * (unless durationMs itself is shorter than that).
 */
import type { Doc, Line, Segment } from './types';
import { newLineId } from './ids';

export const MIN_SEGMENT_MS = 100;
export const DEFAULT_SEGMENT_MS = 3000;

// ---------- helpers ----------

/** Build a valid segment from arbitrary numbers. */
function makeSeg(start: number, end: number, dur: number): Segment {
  const maxStart = Math.max(0, dur - MIN_SEGMENT_MS);
  const s = Math.min(Math.max(Math.round(start), 0), maxStart);
  const e = Math.min(Math.max(Math.round(end), s + MIN_SEGMENT_MS), Math.max(dur, s + 1));
  return { startMs: s, endMs: e };
}

const indexOfId = (doc: Doc, id: string) => doc.lines.findIndex((l) => l.id === id);

function withSegments(doc: Doc, patch: Record<string, Segment | null>): Doc {
  const segments = { ...doc.segments };
  for (const [id, seg] of Object.entries(patch)) {
    if (seg === null) delete segments[id];
    else segments[id] = seg;
  }
  return { lines: doc.lines, segments };
}

function pruneSegments(lines: Line[], segments: Record<string, Segment>): Record<string, Segment> {
  const out: Record<string, Segment> = {};
  for (const l of lines) if (segments[l.id]) out[l.id] = segments[l.id];
  return out;
}

function defaultLength(doc: Doc): number {
  const lens = Object.values(doc.segments)
    .map((s) => s.endMs - s.startMs)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (!lens.length) return DEFAULT_SEGMENT_MS;
  const mid = Math.floor(lens.length / 2);
  return Math.round(lens.length % 2 ? lens[mid] : (lens[mid - 1] + lens[mid]) / 2);
}

// ---------- lyric sheet ----------

/** Trim, drop blank lines and lines starting with '#'. */
export function parseLyricSheet(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

/**
 * Replace the whole sheet. Lines whose text is unchanged (found by an LCS diff of the
 * old and new text sequences) keep their id and timing, so re-pasting an edited sheet
 * does not wipe work. Changed/new lines get fresh ids and are untimed.
 */
export function replaceSheet(doc: Doc, text: string): Doc {
  const next = parseLyricSheet(text);
  const old = doc.lines;
  const n = old.length;
  const m = next.length;
  // lcs[i][j] = LCS length of old[i..] and next[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = old[i].text === next[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const lines: Line[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && old[i].text === next[j]) {
      lines.push(old[i]);
      i++;
      j++;
    } else if (i < n && lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++; // old line dropped
    } else {
      lines.push({ id: newLineId(), text: next[j] });
      j++;
    }
  }
  return { lines, segments: pruneSegments(lines, doc.segments) };
}

export function appendLines(doc: Doc, texts: string[]): Doc {
  const add = texts.map((t) => t.trim()).filter(Boolean).map((text) => ({ id: newLineId(), text }));
  if (!add.length) return doc;
  return { lines: [...doc.lines, ...add], segments: doc.segments };
}

/** Insert a line after `afterId` (or at the end / start when afterId is undefined / null). */
export function addLine(doc: Doc, text: string, afterId?: string | null, id: string = newLineId()): Doc {
  const line: Line = { id, text };
  const at = afterId ? indexOfId(doc, afterId) : -1;
  const lines = afterId === undefined
    ? [...doc.lines, line]
    : [...doc.lines.slice(0, at + 1), line, ...doc.lines.slice(at + 1)];
  return { lines, segments: doc.segments };
}

export function deleteLines(doc: Doc, ids: readonly string[]): Doc {
  const set = new Set(ids);
  if (!doc.lines.some((l) => set.has(l.id))) return doc;
  const lines = doc.lines.filter((l) => !set.has(l.id));
  return { lines, segments: pruneSegments(lines, doc.segments) };
}

export function editText(doc: Doc, id: string, text: string): Doc {
  const i = indexOfId(doc, id);
  if (i < 0 || doc.lines[i].text === text) return doc;
  const lines = doc.lines.slice();
  lines[i] = { id, text };
  return { lines, segments: doc.segments };
}

/** Move a line so it ends up at `toIndex` in the resulting order. */
export function reorder(doc: Doc, id: string, toIndex: number): Doc {
  const from = indexOfId(doc, id);
  if (from < 0) return doc;
  const to = Math.min(Math.max(Math.round(toIndex), 0), doc.lines.length - 1);
  if (to === from) return doc;
  const lines = doc.lines.slice();
  const [l] = lines.splice(from, 1);
  lines.splice(to, 0, l);
  return { lines, segments: doc.segments };
}

/** Move the selected lines up (delta<0) or down (delta>0) by |delta| steps; they stop at the edges, keeping relative order. */
export function moveLines(doc: Doc, ids: readonly string[], delta: number): Doc {
  const sel = new Set(ids);
  const lines = doc.lines.slice();
  const steps = Math.abs(Math.round(delta));
  const dir = delta < 0 ? -1 : 1;
  let changed = false;
  for (let s = 0; s < steps; s++) {
    let moved = false;
    const order = dir < 0
      ? Array.from({ length: lines.length }, (_, k) => k)
      : Array.from({ length: lines.length }, (_, k) => lines.length - 1 - k);
    for (const i of order) {
      const j = i + dir;
      if (j < 0 || j >= lines.length) continue;
      if (sel.has(lines[i].id) && !sel.has(lines[j].id)) {
        [lines[i], lines[j]] = [lines[j], lines[i]];
        moved = true;
      }
    }
    if (!moved) break;
    changed = true;
  }
  return changed ? { lines, segments: doc.segments } : doc;
}

// ---------- timing ----------

/**
 * Stamp the START of a line at `atMs`.
 *
 * - The previous line (by order) is closed at atMs if its end is after atMs (overlap / open end),
 *   keeping at least MIN_SEGMENT_MS. A previous end that is already before atMs is left alone (a
 *   gap is treated as a deliberate instrumental break) unless `opts.prevEndProvisional` says that
 *   end was only a placeholder, in which case it is extended to atMs so consecutive lines abut.
 * - The stamped line keeps its existing end if that is still after the new start; otherwise it gets a
 *   provisional end: the next line's start if the next line is timed and later than the start, else
 *   min(atMs + default, durationMs) where default = median existing segment length (3000ms if none).
 *   Provisional ends are real segment ends (the server needs one), but stamping the following line
 *   will overwrite them via the "close previous" rule.
 */
export function stamp(
  doc: Doc,
  lineId: string,
  atMs: number,
  durationMs: number,
  opts: { prevEndProvisional?: boolean } = {},
): Doc {
  const i = indexOfId(doc, lineId);
  if (i < 0) return doc;
  const at = Math.min(Math.max(Math.round(atMs), 0), Math.max(0, durationMs - MIN_SEGMENT_MS));
  const patch: Record<string, Segment | null> = {};

  if (i > 0) {
    const prev = doc.segments[doc.lines[i - 1].id];
    if (prev && (prev.endMs > at || (opts.prevEndProvisional && prev.startMs < at))) {
      patch[doc.lines[i - 1].id] = makeSeg(prev.startMs, Math.max(at, prev.startMs + MIN_SEGMENT_MS), durationMs);
    }
  }

  const cur = doc.segments[lineId];
  const next = i + 1 < doc.lines.length ? doc.segments[doc.lines[i + 1].id] : undefined;
  let end: number;
  if (cur && cur.endMs >= at + MIN_SEGMENT_MS) end = cur.endMs;
  else if (next && next.startMs >= at + MIN_SEGMENT_MS) end = next.startMs;
  else end = Math.min(at + defaultLength(doc), durationMs);
  patch[lineId] = makeSeg(at, end, durationMs);
  return withSegments(doc, patch);
}

/** Stamp the END of an already-started line. No-op when the line has no start yet. */
export function stampEnd(doc: Doc, lineId: string, atMs: number, durationMs: number): Doc {
  const seg = doc.segments[lineId];
  if (!seg) return doc;
  return withSegments(doc, { [lineId]: makeSeg(seg.startMs, atMs, durationMs) });
}

export function setTimes(doc: Doc, id: string, startMs: number, endMs: number, durationMs: number): Doc {
  if (indexOfId(doc, id) < 0) return doc;
  return withSegments(doc, { [id]: makeSeg(startMs, endMs, durationMs) });
}

/**
 * Move timed lines among `ids` as one group. The delta is clamped so the earliest start stays >= 0
 * and the latest end stays <= durationMs, so relative spacing is always preserved.
 */
export function shift(doc: Doc, ids: readonly string[], deltaMs: number, durationMs: number): Doc {
  const segs = ids.map((id) => [id, doc.segments[id]] as const).filter(([, s]) => s);
  if (!segs.length) return doc;
  const minStart = Math.min(...segs.map(([, s]) => s.startMs));
  const maxEnd = Math.max(...segs.map(([, s]) => s.endMs));
  const d = Math.min(Math.max(Math.round(deltaMs), -minStart), Math.max(0, durationMs - maxEnd));
  if (d === 0) return doc;
  const patch: Record<string, Segment> = {};
  for (const [id, s] of segs) patch[id] = { startMs: s.startMs + d, endMs: s.endMs + d };
  return withSegments(doc, patch);
}

/** Move one edge of each timed line independently; the other edge stays put and min length is kept. */
export function trimEdge(doc: Doc, ids: readonly string[], edge: 'start' | 'end', deltaMs: number, durationMs: number): Doc {
  const d = Math.round(deltaMs);
  const patch: Record<string, Segment> = {};
  for (const id of ids) {
    const s = doc.segments[id];
    if (!s) continue;
    const ns = edge === 'start'
      ? { startMs: Math.min(Math.max(s.startMs + d, 0), s.endMs - MIN_SEGMENT_MS), endMs: s.endMs }
      : { startMs: s.startMs, endMs: Math.min(Math.max(s.endMs + d, s.startMs + MIN_SEGMENT_MS), durationMs) };
    if (ns.startMs !== s.startMs || ns.endMs !== s.endMs) patch[id] = ns;
  }
  return Object.keys(patch).length ? withSegments(doc, patch) : doc;
}

export function clearTiming(doc: Doc, ids: readonly string[]): Doc {
  const patch: Record<string, null> = {};
  for (const id of ids) if (doc.segments[id]) patch[id] = null;
  return Object.keys(patch).length ? withSegments(doc, patch) : doc;
}

// ---------- structure ----------

/** Merge B into A: text "A B", A's id, segment = union span of both (if any). B is removed. */
export function merge(doc: Doc, idA: string, idB: string): Doc {
  const a = indexOfId(doc, idA);
  const b = indexOfId(doc, idB);
  if (a < 0 || b < 0 || a === b) return doc;
  const text = `${doc.lines[a].text} ${doc.lines[b].text}`.trim();
  const lines = doc.lines.filter((l) => l.id !== idB).map((l) => (l.id === idA ? { id: idA, text } : l));
  const sa = doc.segments[idA];
  const sb = doc.segments[idB];
  const segments = pruneSegments(lines, doc.segments);
  const span = sa && sb
    ? { startMs: Math.min(sa.startMs, sb.startMs), endMs: Math.max(sa.endMs, sb.endMs) }
    : sa ?? sb;
  if (span) segments[idA] = span;
  return { lines, segments };
}

/**
 * Split a line at character position `textPos`; the new (right-hand) line follows it and gets
 * `newId`. No-op if either half would be empty. A timed line's segment is cut at atMs when that
 * is at least MIN_SEGMENT_MS inside the segment, otherwise at the midpoint. If the segment is too
 * short to cut (< 2 * MIN_SEGMENT_MS) the left half keeps it and the right half is untimed.
 */
export function split(
  doc: Doc,
  id: string,
  textPos: number,
  atMs: number | null | undefined,
  durationMs: number,
  newId: string = newLineId(),
): Doc {
  const i = indexOfId(doc, id);
  if (i < 0) return doc;
  const full = doc.lines[i].text;
  const left = full.slice(0, textPos).trim();
  const right = full.slice(textPos).trim();
  if (!left || !right) return doc;
  const lines = doc.lines.slice();
  lines.splice(i, 1, { id, text: left }, { id: newId, text: right });
  const segments = { ...doc.segments };
  const seg = doc.segments[id];
  if (seg && seg.endMs - seg.startMs >= 2 * MIN_SEGMENT_MS) {
    const inside = atMs != null && atMs >= seg.startMs + MIN_SEGMENT_MS && atMs <= seg.endMs - MIN_SEGMENT_MS;
    const cut = inside ? Math.round(atMs) : Math.round((seg.startMs + seg.endMs) / 2);
    segments[id] = makeSeg(seg.startMs, cut, durationMs);
    segments[newId] = makeSeg(cut, seg.endMs, durationMs);
  }
  return { lines, segments };
}

// ---------- queries ----------

/** First untimed line index >= fromIndex, or -1. */
export function nextUntimed(doc: Doc, fromIndex: number): number {
  for (let i = Math.max(0, fromIndex); i < doc.lines.length; i++) {
    if (!doc.segments[doc.lines[i].id]) return i;
  }
  return -1;
}

/** Ids of timed lines sorted by start time (ties by line order). */
export function orderedTimedIds(doc: Doc): string[] {
  return doc.lines
    .map((l, i) => ({ id: l.id, i, s: doc.segments[l.id] }))
    .filter((x) => x.s)
    .sort((a, b) => a.s.startMs - b.s.startMs || a.i - b.i)
    .map((x) => x.id);
}

/** Index of the line whose segment contains ms (start <= ms < end); the latest start wins. -1 if none. */
export function lineAt(doc: Doc, ms: number): number {
  let best = -1;
  let bestStart = -Infinity;
  for (let i = 0; i < doc.lines.length; i++) {
    const s = doc.segments[doc.lines[i].id];
    if (s && s.startMs <= ms && ms < s.endMs && s.startMs >= bestStart) {
      best = i;
      bestStart = s.startMs;
    }
  }
  return best;
}

// ---------- validation ----------

export interface Issue {
  code:
    | 'no_lines'
    | 'empty_id'
    | 'duplicate_id'
    | 'non_integer'
    | 'negative_start'
    | 'end_not_after_start'
    | 'unknown_line';
  lineId?: string;
  message: string;
}

/** Mirrors the server's PUT /track/alignment rules. Empty array = OK to send. */
export function validateForServer(doc: Doc): Issue[] {
  const issues: Issue[] = [];
  if (doc.lines.length === 0) issues.push({ code: 'no_lines', message: 'There must be at least one line.' });
  const seen = new Set<string>();
  for (const l of doc.lines) {
    if (typeof l.id !== 'string' || l.id === '') issues.push({ code: 'empty_id', message: 'A line has an empty id.' });
    else if (seen.has(l.id)) issues.push({ code: 'duplicate_id', lineId: l.id, message: `Duplicate line id ${l.id}.` });
    seen.add(l.id);
  }
  // Object keys guarantee at most one segment per line id.
  for (const [id, s] of Object.entries(doc.segments)) {
    if (!seen.has(id)) issues.push({ code: 'unknown_line', lineId: id, message: `Segment refers to unknown line ${id}.` });
    if (!Number.isInteger(s.startMs) || !Number.isInteger(s.endMs)) {
      issues.push({ code: 'non_integer', lineId: id, message: 'Times must be whole milliseconds.' });
    }
    if (s.startMs < 0) issues.push({ code: 'negative_start', lineId: id, message: 'Start must be >= 0.' });
    if (s.endMs <= s.startMs) issues.push({ code: 'end_not_after_start', lineId: id, message: 'End must be after start.' });
  }
  return issues;
}

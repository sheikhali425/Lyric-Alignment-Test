import { test, expect } from '@playwright/test';
import {
  stamp, stampEnd, shift, merge, split, parseLyricSheet, validateForServer, replaceSheet,
  trimEdge, lineAt, moveLines, MIN_SEGMENT_MS,
} from '../apps/web/src/domain/ops';
import { formatMs, parseTime, formatShort } from '../apps/web/src/domain/time';
import { store } from '../apps/web/src/state/store';
import { toLrc } from '../apps/web/src/domain/lrc';
import type { Doc } from '../apps/web/src/domain/types';

const DUR = 60_000;
const mk = (n: number, segs: Record<string, [number, number]> = {}): Doc => ({
  lines: Array.from({ length: n }, (_, i) => ({ id: `l${i}`, text: i % 2 ? 'same text' : `line ${i}` })),
  segments: Object.fromEntries(Object.entries(segs).map(([k, [s, e]]) => [k, { startMs: s, endMs: e }])),
});

test('stamp sequence closes previous ends', () => {
  let d = mk(3);
  d = stamp(d, 'l0', 1000, DUR);
  expect(d.segments.l0).toEqual({ startMs: 1000, endMs: 4000 }); // provisional: default 3000
  d = stamp(d, 'l1', 2500, DUR);
  expect(d.segments.l0.endMs).toBe(2500); // closed at next stamp
  expect(d.segments.l1.startMs).toBe(2500);
  d = stamp(d, 'l2', 9000, DUR);
  expect(d.segments.l1.endMs).toBeLessThanOrEqual(5500); // not extended; provisional end was start+median
  expect(d.segments.l2.startMs).toBe(9000);
  expect(validateForServer(d)).toEqual([]);
});

test('stamp extends a provisional previous end so lines abut, but keeps a deliberate gap', () => {
  let d = mk(3);
  d = stamp(d, 'l0', 1000, DUR); // provisional end 4000
  d = stamp(d, 'l1', 6000, DUR, { prevEndProvisional: true });
  expect(d.segments.l0).toEqual({ startMs: 1000, endMs: 6000 });
  d = stampEnd(d, 'l1', 8000, DUR); // K: deliberate end, then an instrumental gap
  d = stamp(d, 'l2', 12000, DUR, { prevEndProvisional: false });
  expect(d.segments.l1.endMs).toBe(8000);
  expect(validateForServer(d)).toEqual([]);
});

test('stamp near end of track stays valid and clamped', () => {
  const d = stamp(mk(1), 'l0', DUR + 5000, DUR);
  expect(d.segments.l0.endMs).toBeLessThanOrEqual(DUR);
  expect(d.segments.l0.endMs - d.segments.l0.startMs).toBeGreaterThanOrEqual(MIN_SEGMENT_MS);
});

test('stamp does not mutate input; stampEnd sets end', () => {
  const d0 = mk(2, { l0: [0, 5000] });
  const snap = JSON.stringify(d0);
  const d1 = stampEnd(d0, 'l0', 3210, DUR);
  expect(JSON.stringify(d0)).toBe(snap);
  expect(d1.segments.l0.endMs).toBe(3210);
  expect(stampEnd(d0, 'l1', 3000, DUR)).toBe(d0);
});

test('shift clamps as a group preserving spacing', () => {
  const d = mk(3, { l0: [500, 1500], l1: [2000, 3000], l2: [58_000, 59_000] });
  const left = shift(d, ['l0', 'l1'], -5000, DUR);
  expect(left.segments.l0.startMs).toBe(0);
  expect(left.segments.l1.startMs).toBe(1500); // spacing 1500 preserved
  const right = shift(d, ['l1', 'l2'], 9000, DUR);
  expect(right.segments.l2.endMs).toBe(DUR);
  expect(right.segments.l2.startMs - right.segments.l1.startMs).toBe(56_000);
  expect(shift(d, ['l0'], 0, DUR)).toBe(d);
});

test('trimEdge keeps min length', () => {
  const d = mk(1, { l0: [1000, 1500] });
  expect(trimEdge(d, ['l0'], 'end', -9999, DUR).segments.l0.endMs).toBe(1000 + MIN_SEGMENT_MS);
  expect(trimEdge(d, ['l0'], 'start', -9999, DUR).segments.l0.startMs).toBe(0);
});

test('merge keeps A id and union span; split sets sane timings', () => {
  const d = mk(3, { l0: [1000, 2000], l1: [3000, 4000] });
  const m = merge(d, 'l0', 'l1');
  expect(m.lines.map((l) => l.id)).toEqual(['l0', 'l2']);
  expect(m.lines[0].text).toBe('line 0 same text');
  expect(m.segments.l0).toEqual({ startMs: 1000, endMs: 4000 });
  expect(m.segments.l1).toBeUndefined();

  const s = split(d, 'l0', 4, 1400, DUR, 'new');
  expect(s.lines.map((l) => l.id)).toEqual(['l0', 'new', 'l1', 'l2']);
  expect(s.lines[0].text).toBe('line');
  expect(s.lines[1].text).toBe('0');
  expect(s.segments.l0).toEqual({ startMs: 1000, endMs: 1400 });
  expect(s.segments.new).toEqual({ startMs: 1400, endMs: 2000 });
  const mid = split(d, 'l0', 4, 9999, DUR, 'new'); // outside -> midpoint
  expect(mid.segments.l0.endMs).toBe(1500);
  expect(validateForServer(mid)).toEqual([]);
  expect(split(d, 'l0', 0, null, DUR)).toBe(d); // empty half is a no-op
});

test('parseLyricSheet skips blanks and comments; replaceSheet keeps ids of unchanged lines', () => {
  expect(parseLyricSheet('# verse\n  hello  \n\n   \n#x\r\nworld')).toEqual(['hello', 'world']);
  const d = mk(3, { l0: [0, 1000], l2: [2000, 3000] });
  const r = replaceSheet(d, 'line 0\nbrand new\nsame text\nline 2');
  expect(r.lines[0].id).toBe('l0');
  expect(r.lines[3].id).toBe('l2');
  expect(r.segments.l2).toBeDefined();
  expect(r.lines[1].id).not.toBe('l1');
  expect(r.segments[r.lines[1].id]).toBeUndefined();
});

test('moveLines and lineAt', () => {
  const d = mk(4, { l0: [0, 2000], l1: [1000, 3000] });
  expect(moveLines(d, ['l1', 'l2'], -1).lines.map((l) => l.id)).toEqual(['l1', 'l2', 'l0', 'l3']);
  expect(moveLines(d, ['l0'], -1)).toBe(d);
  expect(lineAt(d, 1500)).toBe(1); // latest start wins
  expect(lineAt(d, 500)).toBe(0);
  expect(lineAt(d, 5000)).toBe(-1);
});

test('time format/parse round-trip', () => {
  for (const ms of [0, 5, 999, 1000, 61_234, 3_599_999]) expect(parseTime(formatMs(ms))).toBe(ms);
  expect(formatMs(61_234)).toBe('1:01.234');
  expect(formatShort(61_999)).toBe('1:01');
  expect(parseTime('12.5')).toBe(12_500);
  expect(parseTime('1:05')).toBe(65_000);
  expect(parseTime('1:75')).toBeNull();
  expect(parseTime('abc')).toBeNull();
});

test('validateForServer catches bad data', () => {
  const d: Doc = {
    lines: [{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }],
    segments: { a: { startMs: 100, endMs: 100 }, ghost: { startMs: -1, endMs: 5.5 } },
  };
  const codes = validateForServer(d).map((i) => i.code);
  expect(codes).toEqual(expect.arrayContaining(['duplicate_id', 'end_not_after_start', 'unknown_line', 'negative_start', 'non_integer']));
  expect(validateForServer({ lines: [], segments: {} }).map((i) => i.code)).toContain('no_lines');
});

test('toLrc orders by time and omits untimed lines', () => {
  const d = mk(3, { l0: [65_430, 66_000], l2: [1_000, 2_000] });
  const lrc = toLrc({ key: 'k', source: 'local', title: 'T', artist: 'A', audioUrl: '', durationMs: DUR, doc: d });
  expect(lrc).toBe('[ti:T]\n[ar:A]\n[00:01.00]line 2\n[01:05.43]line 0\n');
});

test('store: undo/redo, coalescing, transaction, selection pruning, dirty', () => {
  const d = mk(3, { l0: [1000, 2000] });
  store.loadProject({ key: 'k', source: 'local', title: '', artist: '', audioUrl: '', durationMs: DUR, doc: d });
  expect(store.getState().cursorId).toBe('l1');
  for (let i = 0; i < 5; i++) store.apply((x) => shift(x, ['l0'], 10, DUR), { coalesceKey: 'nudge' });
  expect(store.getState().project!.doc.segments.l0.startMs).toBe(1050);
  expect(store.getState().history.past.length).toBe(1);
  expect(store.getState().dirty).toBe(true);
  store.undo();
  expect(store.getState().project!.doc.segments.l0.startMs).toBe(1000);
  expect(store.getState().dirty).toBe(false);
  store.redo();
  store.beginTransaction();
  for (let i = 0; i < 10; i++) store.applyLive((x) => shift(x, ['l0'], 100, DUR));
  store.commitTransaction();
  expect(store.getState().history.past.length).toBe(2);
  store.beginTransaction();
  store.applyLive((x) => shift(x, ['l0'], 100, DUR));
  store.cancelTransaction();
  expect(store.getState().project!.doc.segments.l0.startMs).toBe(2050);
  store.select(['l1', 'l2']);
  store.apply((x) => ({ ...x, lines: x.lines.filter((l) => l.id !== 'l2') }));
  expect(store.getState().selection).toEqual(['l1']);
});

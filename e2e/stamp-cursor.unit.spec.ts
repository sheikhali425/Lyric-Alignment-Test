import { test, expect } from '@playwright/test';
import { MIN_SEGMENT_MS } from '../apps/web/src/domain/ops';
import { store } from '../apps/web/src/state/store';
import { playback } from '../apps/web/src/state/playback';
import { clearSelectedTiming, redo, stampNext, undo } from '../apps/web/src/state/commands';
import type { Doc } from '../apps/web/src/domain/types';

const DUR = 60_000;
const mk = (n: number, segs: Record<string, [number, number]> = {}): Doc => ({
  lines: Array.from({ length: n }, (_, i) => ({ id: `l${i}`, text: `line ${i}` })),
  segments: Object.fromEntries(Object.entries(segs).map(([k, [s, e]]) => [k, { startMs: s, endMs: e }])),
});
const load = (doc: Doc) =>
  store.loadProject({ key: 'k', source: 'local', title: '', artist: '', audioUrl: '', durationMs: DUR, doc });
const seg = (id: string) => store.getState().project!.doc.segments[id];
const cursor = () => store.getState().cursorId;

// Stand-in for the <audio> element: only currentTime/duration matter to getMs and seek. The decoded
// audio runs slightly past the stated duration, as the real track does.
const audio = { currentTime: 0, duration: DUR / 1000 + 0.05, paused: true, ended: false, addEventListener() {}, removeEventListener() {} };
playback.attach(audio as unknown as HTMLAudioElement);
const at = (ms: number) => playback.seek(ms);

test('a fully timed sheet opens with no cursor, so Enter does not restamp line 1', () => {
  load(mk(2, { l0: [1000, 2000], l1: [2000, 3000] }));
  expect(cursor()).toBeNull();
  at(5000);
  stampNext();
  expect(seg('l0').startMs).toBe(1000);
});

test('undo of a clear puts the cursor back where it was', () => {
  load(mk(4, { l0: [1000, 2000], l1: [2000, 3000] }));
  expect(cursor()).toBe('l2');
  store.select(['l0']);
  clearSelectedTiming();
  expect(cursor()).toBe('l0');
  undo();
  expect(seg('l0').startMs).toBe(1000);
  expect(cursor()).toBe('l2');
  redo();
  expect(seg('l0')).toBeUndefined();
  expect(cursor()).toBe('l0');
});

test('redo of a stamp advances the cursor again', () => {
  load(mk(3));
  at(1000);
  stampNext();
  expect(cursor()).toBe('l1');
  undo();
  expect(cursor()).toBe('l0');
  redo();
  expect(seg('l0').startMs).toBe(1000);
  expect(cursor()).toBe('l1');
});

test('stamps after the end of the track are ignored, not piled up at the end', () => {
  load(mk(3, { l0: [50_000, 55_000] }));
  at(DUR + 30);
  stampNext();
  stampNext();
  expect(seg('l1')).toBeUndefined();
  expect(seg('l2')).toBeUndefined();
  expect(cursor()).toBe('l1');
  at(DUR - MIN_SEGMENT_MS);
  stampNext();
  expect(seg('l1').startMs).toBe(DUR - MIN_SEGMENT_MS);
});

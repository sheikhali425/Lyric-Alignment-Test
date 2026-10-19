/** Pixel <-> millisecond conversions for the timeline (not unit conversions: those live in domain/time.ts). */

export const msToPx = (ms: number, pxPerSec: number): number => (ms / 1000) * pxPerSec;
export const pxToMs = (px: number, pxPerSec: number): number => (px / pxPerSec) * 1000;

export const RULER_H = 26;
export const WAVE_H = 140;
export const LANE_PAD = 6;
export const ROW_H = 28;
export const ROW_GAP = 3;
export const EDGE_PX = 6;
export const DRAG_THRESHOLD_PX = 3;
export const SNAP_PX = 8;

export const laneHeight = (rows: number): number => LANE_PAD * 2 + Math.max(1, rows) * (ROW_H + ROW_GAP) - ROW_GAP;
export const rowTop = (row: number): number => LANE_PAD + row * (ROW_H + ROW_GAP);

const STEPS_S = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
/** Smallest "nice" tick step (seconds) that is at least `minPx` wide on screen. */
export function tickStepSec(pxPerSec: number, minPx = 80): number {
  return STEPS_S.find((s) => s * pxPerSec >= minPx) ?? STEPS_S[STEPS_S.length - 1];
}

export interface RowItem {
  id: string;
  index: number;
  text: string;
  startMs: number;
  endMs: number;
  row: number;
}

/** Greedy row packing: overlapping segments stack into further rows. */
export function layoutRows(
  lines: readonly { id: string; text: string }[],
  segments: Record<string, { startMs: number; endMs: number }>,
): { items: RowItem[]; rows: number } {
  const items: RowItem[] = [];
  lines.forEach((l, index) => {
    const s = segments[l.id];
    if (s) items.push({ id: l.id, index, text: l.text, startMs: s.startMs, endMs: s.endMs, row: 0 });
  });
  const sorted = [...items].sort((a, b) => a.startMs - b.startMs || a.index - b.index);
  const rowEnds: number[] = [];
  for (const it of sorted) {
    let r = rowEnds.findIndex((end) => end <= it.startMs);
    if (r < 0) r = rowEnds.length;
    rowEnds[r] = it.endMs;
    it.row = r;
  }
  return { items, rows: Math.max(1, rowEnds.length) };
}

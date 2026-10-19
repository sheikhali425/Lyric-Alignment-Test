/**
 * High-level editor commands. Keyboard shortcuts and on-screen buttons both call these, so
 * there is exactly one implementation of "stamp the next line", "nudge", "merge", ...
 * Each command is one undo step unless it passes a coalesceKey (nudges).
 */
import { useSyncExternalStore } from 'react';
import type { Doc, Project } from '../domain/types';
import * as ops from '../domain/ops';
import { newLineId } from '../domain/ids';
import { store } from './store';
import { playback } from './playback';
import { toast } from '../components/Toast/toastStore';

// ---------- tap offset (reaction-lag compensation) ----------

const TAP_KEY = 'lyric-editor.tapOffsetMs';
export const MAX_TAP_OFFSET_MS = 500;
/**
 * Default 0: lag is per person/device, so guessing a number would silently shift every stamp.
 * The LyricsPane header exposes it (persisted) for users who tap ~100-200 ms late.
 */
export const DEFAULT_TAP_OFFSET_MS = 0;

function readOffset(): number {
  try {
    const n = Number(localStorage.getItem(TAP_KEY));
    return Number.isFinite(n) && localStorage.getItem(TAP_KEY) !== null ? clampOffset(n) : DEFAULT_TAP_OFFSET_MS;
  } catch {
    return DEFAULT_TAP_OFFSET_MS;
  }
}
const clampOffset = (n: number) => Math.min(MAX_TAP_OFFSET_MS, Math.max(0, Math.round(n)));
let tapOffset = readOffset();
const offsetListeners = new Set<() => void>();

export function getTapOffset(): number {
  return tapOffset;
}
export function setTapOffset(ms: number): void {
  const v = clampOffset(Number.isFinite(ms) ? ms : 0);
  if (v === tapOffset) return;
  tapOffset = v;
  try {
    localStorage.setItem(TAP_KEY, String(v));
  } catch {
    /* storage unavailable: keep in memory */
  }
  offsetListeners.forEach((l) => l());
}
export function useTapOffset(): [number, (ms: number) => void] {
  const v = useSyncExternalStore(
    (cb) => {
      offsetListeners.add(cb);
      return () => offsetListeners.delete(cb);
    },
    getTapOffset,
    getTapOffset,
  );
  return [v, setTapOffset];
}

// ---------- helpers ----------

const project = (): Project | null => store.getState().project;

/** Selected ids in document order. */
export function selectedIds(): string[] {
  const s = store.getState();
  if (!s.project || !s.selection.length) return [];
  const sel = new Set(s.selection);
  return s.project.doc.lines.filter((l) => sel.has(l.id)).map((l) => l.id);
}

const indexOf = (doc: Doc, id: string | null) => (id ? doc.lines.findIndex((l) => l.id === id) : -1);

// ---------- edit-request channel (F2 / "add line" -> LyricsPane inline editor) ----------

const editListeners = new Set<(id: string) => void>();
export function onEditRequest(cb: (id: string) => void): () => void {
  editListeners.add(cb);
  return () => editListeners.delete(cb);
}
/** Ask the lyrics list to open the inline editor for `id` (default: the focused/only selected line). */
export function requestEdit(id?: string): void {
  const target = id ?? getFocusId() ?? undefined;
  if (target) editListeners.forEach((l) => l(target));
}

// ---------- stamping ----------

/**
 * Edits that move the stamp cursor (stamp, clear timing) log the doc they produced and the cursor
 * before/after, so undo and redo can put the cursor back. The cursor is not part of history; without
 * this, undoing a clear would leave the cursor on a line that is timed again, and the next Enter
 * would silently restamp it.
 */
interface CursorStep {
  docAfter: Doc;
  cursorBefore: string | null;
  cursorAfter: string | null;
}
const cursorLog: CursorStep[] = [];
const cursorRedo: CursorStep[] = [];

/** Call after an edit that moved the cursor. A no-op edit is not logged (undo would misattribute it). */
function logCursorStep(docBefore: Doc, cursorBefore: string | null): void {
  const after = project()?.doc;
  if (!after || after === docBefore) return;
  cursorLog.push({ docAfter: after, cursorBefore, cursorAfter: store.getState().cursorId });
  if (cursorLog.length > 200) cursorLog.shift();
  cursorRedo.length = 0;
}

/**
 * Stamp the START of the cursor line at playhead - tapOffset, then advance the cursor to the next line
 * by order (it does NOT skip already-timed lines: a re-stamp pass over a rough sheet should visit every
 * line). Past the last line the cursor becomes null; with no cursor we start at the first untimed line.
 */
/**
 * Lines stamped in this session whose end is still the placeholder ops.stamp invented. The next
 * stamp extends such an end to meet it (lines abut); a K press makes the end deliberate, so a gap
 * after it survives. Session-only on purpose: after a reload every saved end counts as deliberate.
 */
const provisionalEnds = new Set<string>();

export function stampNext(): void {
  const p = project();
  if (!p || !p.doc.lines.length) return;
  const { doc } = p;
  let id = store.getState().cursorId;
  if (id === null || indexOf(doc, id) < 0) {
    const u = ops.nextUntimed(doc, 0);
    if (u < 0) return;
    id = doc.lines[u].id;
  }
  const at = Math.max(0, playback.getMs() - tapOffset);
  // No room for a line after this point: ops.stamp would clamp every such stamp to the same
  // duration - MIN_SEGMENT_MS, piling zero-gap lines on top of each other at the very end.
  if (at > p.durationMs - ops.MIN_SEGMENT_MS) {
    toast.info('The track has ended. Seek back to stamp more lines.');
    return;
  }
  const cursorBefore = store.getState().cursorId;
  const target = id;
  const prevId = doc.lines[indexOf(doc, target) - 1]?.id;
  const prevEndProvisional = prevId !== undefined && provisionalEnds.has(prevId);
  store.apply((d) => ops.stamp(d, target, at, p.durationMs, { prevEndProvisional }));
  if (prevId !== undefined) provisionalEnds.delete(prevId);
  provisionalEnds.add(target);
  const after = project()!.doc;
  const i = indexOf(after, target);
  store.setCursor(after.lines[i + 1]?.id ?? null);
  logCursorStep(doc, cursorBefore);
}

/** K: set the end of the line before the cursor (the one just stamped) to now - tapOffset. */
export function stampEndCurrent(): void {
  const p = project();
  if (!p) return;
  const { doc } = p;
  const ci = indexOf(doc, store.getState().cursorId);
  const i = ci < 0 ? doc.lines.length - 1 : ci - 1;
  const line = doc.lines[i];
  if (!line) return;
  const at = Math.max(0, playback.getMs() - tapOffset);
  provisionalEnds.delete(line.id);
  store.apply((d) => ops.stampEnd(d, line.id, at, p.durationMs));
}

/** Undo that also restores the stamp cursor if the undone step moved it (stamp, clear timing). */
export function undo(): void {
  const p = project();
  const top = cursorLog[cursorLog.length - 1];
  if (p && top && p.doc === top.docAfter) {
    cursorLog.pop();
    store.undo();
    store.setCursor(top.cursorBefore);
    cursorRedo.push(top);
    return;
  }
  store.undo();
}
/** Redo that re-applies the cursor move of a redone stamp / clear. */
export function redo(): void {
  store.redo();
  const p = project();
  const top = cursorRedo[cursorRedo.length - 1];
  if (p && top && p.doc === top.docAfter) {
    cursorRedo.pop();
    store.setCursor(top.cursorAfter);
    cursorLog.push(top);
  }
}

// ---------- selection navigation ----------

let focusId: string | null = null;
/** The line the keyboard "caret" is on (the moving end of a shift-extended selection). */
export function getFocusId(): string | null {
  const s = store.getState();
  if (focusId && s.selection.includes(focusId)) return focusId;
  return s.selection[s.selection.length - 1] ?? null;
}
export function setFocusId(id: string | null): void {
  focusId = id;
}

/** Up/Down through lines. With extend, grows a range from the anchor. With no selection it starts at the cursor line. */
export function moveFocus(delta: number, extend = false): void {
  const s = store.getState();
  if (!s.project || !s.project.doc.lines.length) return;
  const lines = s.project.doc.lines;
  const cur = getFocusId();
  if (!cur) {
    const ci = indexOf(s.project.doc, s.cursorId);
    const i = ci >= 0 ? ci : delta > 0 ? 0 : lines.length - 1;
    focusId = lines[i].id;
    store.select([focusId], focusId);
    return;
  }
  const idx = indexOf(s.project.doc, cur);
  const ni = Math.min(lines.length - 1, Math.max(0, idx + delta));
  focusId = lines[ni].id;
  if (extend) store.selectRange(focusId);
  else store.select([focusId], focusId);
}

// ---------- timing edits ----------

/** Nudge selected lines. edge 'both' moves them as a group (spacing kept); 'start'/'end' trims one edge. */
export function nudge(deltaMs: number, edge: 'both' | 'start' | 'end' = 'both'): void {
  const p = project();
  const ids = selectedIds();
  if (!p || !ids.length) return;
  store.apply(
    (d) => (edge === 'both' ? ops.shift(d, ids, deltaMs, p.durationMs) : ops.trimEdge(d, ids, edge, deltaMs, p.durationMs)),
    { coalesceKey: `nudge:${edge}` },
  );
}

/** Shift selection by an arbitrary delta (Inspector "Shift by"). One undo step. */
export function shiftSelected(deltaMs: number): void {
  const p = project();
  const ids = selectedIds();
  if (!p || !ids.length || !deltaMs) return;
  store.apply((d) => ops.shift(d, ids, deltaMs, p.durationMs));
}

/** Set one edge of a line to an absolute time. Untimed lines get a default-length segment around it. */
export function setEdge(id: string, edge: 'start' | 'end', ms: number): void {
  const p = project();
  if (!p) return;
  store.apply((d) => {
    const seg = d.segments[id];
    if (seg) return edge === 'start' ? ops.setTimes(d, id, ms, seg.endMs, p.durationMs) : ops.setTimes(d, id, seg.startMs, ms, p.durationMs);
    return edge === 'start'
      ? ops.setTimes(d, id, ms, ms + ops.DEFAULT_SEGMENT_MS, p.durationMs)
      : ops.setTimes(d, id, Math.max(0, ms - ops.DEFAULT_SEGMENT_MS), ms, p.durationMs);
  });
}

export function setEdgeToPlayhead(id: string, edge: 'start' | 'end'): void {
  setEdge(id, edge, playback.getMs());
}

/** Clear timing of the selection; the stamp cursor jumps to the first cleared line so it can be re-stamped. */
export function clearSelectedTiming(): void {
  const p = project();
  const ids = selectedIds();
  if (!p || !ids.length) return;
  const cursorBefore = store.getState().cursorId;
  store.apply((d) => ops.clearTiming(d, ids));
  store.setCursor(ids[0]);
  logCursorStep(p.doc, cursorBefore);
}

// ---------- structure edits ----------

export function deleteSelected(): void {
  const p = project();
  const ids = selectedIds();
  if (!p || !ids.length) return;
  const first = indexOf(p.doc, ids[0]);
  store.apply((d) => ops.deleteLines(d, ids));
  const lines = project()!.doc.lines;
  const next = lines[Math.min(first, lines.length - 1)];
  if (next) {
    focusId = next.id;
    store.select([next.id], next.id);
  } else store.clearSelection();
}

/** Merge a run of consecutive selected lines into the first; a single selected line merges with the next. */
export function mergeSelected(): void {
  const p = project();
  const ids = selectedIds();
  if (!p || !ids.length) return;
  const { lines } = p.doc;
  let chain = ids;
  if (ids.length === 1) {
    const next = lines[indexOf(p.doc, ids[0]) + 1];
    if (!next) return;
    chain = [ids[0], next.id];
  } else {
    const base = indexOf(p.doc, ids[0]);
    if (!ids.every((id, k) => lines[base + k]?.id === id)) return; // non-consecutive: ambiguous, do nothing
  }
  const [head, ...rest] = chain;
  store.apply((d) => rest.reduce((acc, id) => ops.merge(acc, head, id), d));
  focusId = head;
  store.select([head], head);
}

/** Word-boundary text positions of `text` (index just after each word except the last). */
export function wordGaps(text: string): number[] {
  const gaps: number[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) gaps.push(m.index + m[0].length);
  gaps.pop();
  return gaps;
}

/** The word gap closest to the middle of the text, or -1 for a one-word line. */
export function middleGap(text: string): number {
  const gaps = wordGaps(text);
  if (!gaps.length) return -1;
  return gaps.reduce((best, g) => (Math.abs(g - text.length / 2) < Math.abs(best - text.length / 2) ? g : best));
}

/**
 * Split a line at the playhead. Target: `id`, else the only selected line, else the line under the playhead.
 * Text splits at `textPos` or the middle word boundary; ops.split falls back to the segment midpoint when the
 * playhead is outside the line. Returns false when nothing could be split.
 */
export function splitAtPlayhead(opts: { id?: string; textPos?: number } = {}): boolean {
  const p = project();
  if (!p) return false;
  const sel = selectedIds();
  const at = playback.getMs();
  const id = opts.id ?? (sel.length === 1 ? sel[0] : p.doc.lines[ops.lineAt(p.doc, at)]?.id);
  if (!id) return false;
  const line = p.doc.lines[indexOf(p.doc, id)];
  const pos = opts.textPos ?? middleGap(line.text);
  if (pos < 0) return false;
  const newId = newLineId();
  const before = p.doc;
  store.apply((d) => ops.split(d, id, pos, at, p.durationMs, newId));
  if (project()!.doc === before) return false;
  focusId = newId;
  store.select([id, newId], id);
  return true;
}

export function moveSelected(delta: number): void {
  const ids = selectedIds();
  if (!ids.length) return;
  store.apply((d) => ops.moveLines(d, ids, delta), { coalesceKey: 'move' });
}

/** Add a line after the last selected line (end of sheet when nothing is selected), select it and open its editor. */
/**
 * A line added by "+ Add line" whose first text has not been committed yet. Adding it opens a store
 * transaction, so "add + type its text" is ONE undo step, and cancelling the edit removes the line
 * instead of leaving a placeholder "New line" behind.
 */
let pendingNewLine: string | null = null;

export function addLineAfterSelection(): string | null {
  const p = project();
  if (!p) return null;
  if (pendingNewLine) cancelLineEdit(pendingNewLine);
  const ids = selectedIds();
  const after = ids.length ? ids[ids.length - 1] : undefined;
  const id = newLineId();
  store.beginTransaction();
  store.applyLive((d) => ops.addLine(d, 'New line', after, id));
  pendingNewLine = id;
  focusId = id;
  store.select([id], id);
  requestEdit(id);
  return id;
}

/** Commit inline text editing. Empty text is rejected (returns false). */
export function editLineText(id: string, text: string): boolean {
  const t = text.trim();
  if (!t) {
    if (id === pendingNewLine) cancelLineEdit(id);
    return false;
  }
  if (id === pendingNewLine) {
    store.applyLive((d) => ops.editText(d, id, t));
    pendingNewLine = null;
    store.commitTransaction();
    return true;
  }
  store.apply((d) => ops.editText(d, id, t));
  return true;
}

/** Inline edit abandoned (Escape). For a just-added line this removes it again. */
export function cancelLineEdit(id: string): void {
  if (id !== pendingNewLine) return;
  pendingNewLine = null;
  store.cancelTransaction();
}

// ---------- playback helpers ----------

/** P: play the selected lines' span (auto-pauses at its end); with no selection, play from the cursor line; else toggle. */
export function playSelection(): void {
  const p = project();
  if (!p) return;
  const segs = selectedIds().map((id) => p.doc.segments[id]).filter(Boolean);
  if (segs.length) {
    playback.playRange(Math.min(...segs.map((s) => s.startMs)), Math.max(...segs.map((s) => s.endMs)));
    return;
  }
  const c = store.getState().cursorId;
  const seg = c ? p.doc.segments[c] : undefined;
  if (seg) {
    playback.seek(seg.startMs);
    void playback.play();
  } else playback.toggle();
}

export function seekBy(deltaMs: number): void {
  playback.seek(playback.getMs() + deltaMs);
}

/**
 * Small external store (no library) for the editor document.
 *
 * History is snapshot based: every entry is a whole Doc. Docs are immutable and ops share
 * structure, so a snapshot costs little and undo is trivially correct.
 * Selection, anchor and stamp cursor are NOT part of history, but are pruned of ids that
 * no longer exist after every doc change.
 */
import type { Doc, Project } from '../domain/types';
import { nextUntimed } from '../domain/ops';
import { shallowEqual, useExternalSelector } from './external';

export { shallowEqual };

export const HISTORY_CAP = 200;
export const COALESCE_MS = 600;

export interface EditorState {
  project: Project | null;
  history: { past: Doc[]; future: Doc[] };
  selection: string[];
  anchorId: string | null;
  cursorId: string | null;
  dirty: boolean;
  savedDocJson?: string;
}

/** Canonical, order-stable fingerprint of a doc (independent of segment key order). */
export function docKey(doc: Doc): string {
  return JSON.stringify([
    doc.lines.map((l) => [l.id, l.text]),
    doc.lines.map((l) => {
      const s = doc.segments[l.id];
      return s ? [s.startMs, s.endMs] : 0;
    }),
  ]);
}

const EMPTY: EditorState = {
  project: null,
  history: { past: [], future: [] },
  selection: [],
  anchorId: null,
  cursorId: null,
  dirty: false,
};

let state: EditorState = EMPTY;
const listeners = new Set<() => void>();
let txStart: Doc | null = null;
let lastCoalesce: { key: string; at: number } | null = null;

function set(next: EditorState) {
  state = next;
  listeners.forEach((l) => l());
}

/** Install a new doc into state: prune selection, recompute dirty. */
function withDoc(s: EditorState, doc: Doc, history: EditorState['history']): EditorState {
  if (!s.project) return s;
  const ids = new Set(doc.lines.map((l) => l.id));
  const selection = s.selection.filter((id) => ids.has(id));
  return {
    ...s,
    project: { ...s.project, doc },
    history,
    selection: selection.length === s.selection.length ? s.selection : selection,
    anchorId: s.anchorId && ids.has(s.anchorId) ? s.anchorId : null,
    cursorId: s.cursorId && ids.has(s.cursorId) ? s.cursorId : null,
    dirty: docKey(doc) !== s.savedDocJson,
  };
}

const pushPast = (past: Doc[], doc: Doc) => [...past, doc].slice(-HISTORY_CAP);

export const store = {
  getState: (): EditorState => state,
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  /**
   * Load a project, resetting history/selection. The cursor starts at the first untimed line, or is
   * null when every line is timed (so a stray Enter cannot restamp line 1; see stampNext).
   */
  loadProject(p: Project) {
    txStart = null;
    lastCoalesce = null;
    const i = nextUntimed(p.doc, 0);
    const cursor = i >= 0 ? p.doc.lines[i].id : null;
    set({
      project: p,
      history: { past: [], future: [] },
      selection: [],
      anchorId: null,
      cursorId: cursor,
      dirty: false,
      savedDocJson: docKey(p.doc),
    });
  },

  /**
   * Replace the project (e.g. "take server's version" after a conflict).
   * history: 'push' (default) makes it undoable, 'reset' clears history, 'keep' leaves history alone.
   * savedDoc: the doc to treat as saved (default: unchanged).
   */
  replaceProject(p: Project, opts: { history?: 'push' | 'reset' | 'keep'; savedDoc?: Doc } = {}) {
    if (!state.project) return store.loadProject(p);
    const mode = opts.history ?? 'push';
    txStart = null;
    lastCoalesce = null;
    const h = state.history;
    const history =
      mode === 'reset' ? { past: [], future: [] }
      : mode === 'keep' ? h
      : { past: pushPast(h.past, state.project.doc), future: [] };
    const savedDocJson = opts.savedDoc ? docKey(opts.savedDoc) : state.savedDocJson;
    set(withDoc({ ...state, project: p, savedDocJson }, p.doc, history));
  },

  /** Update non-doc metadata (title, artist, ...). Not undoable. */
  patchProject(patch: Partial<Omit<Project, 'doc'>>) {
    if (!state.project) return;
    set({ ...state, project: { ...state.project, ...patch } });
  },

  /** Apply a pure doc edit as one undo step. Same coalesceKey within COALESCE_MS merges into one step. */
  apply(fn: (doc: Doc) => Doc, opts: { coalesceKey?: string } = {}) {
    if (!state.project) return;
    if (txStart) return store.applyLive(fn);
    const doc = state.project.doc;
    const next = fn(doc);
    if (next === doc) return;
    const now = Date.now();
    const key = opts.coalesceKey;
    const coalesce =
      key !== undefined && lastCoalesce?.key === key && now - lastCoalesce.at < COALESCE_MS && state.history.past.length > 0;
    lastCoalesce = key !== undefined ? { key, at: now } : null;
    const past = coalesce ? state.history.past : pushPast(state.history.past, doc);
    set(withDoc(state, next, { past, future: [] }));
  },

  /** Drag support: beginTransaction, then applyLive repeatedly, then commit (one undo entry) or cancel. */
  beginTransaction() {
    if (!state.project || txStart) return;
    lastCoalesce = null;
    txStart = state.project.doc;
  },
  applyLive(fn: (doc: Doc) => Doc) {
    if (!state.project) return;
    const next = fn(state.project.doc);
    if (next === state.project.doc) return;
    set(withDoc(state, next, state.history));
  },
  commitTransaction() {
    if (!txStart || !state.project) {
      txStart = null;
      return;
    }
    const start = txStart;
    txStart = null;
    if (state.project.doc === start) return;
    set({ ...state, history: { past: pushPast(state.history.past, start), future: [] } });
  },
  cancelTransaction() {
    if (!txStart || !state.project) {
      txStart = null;
      return;
    }
    const start = txStart;
    txStart = null;
    set(withDoc(state, start, state.history));
  },

  undo() {
    if (!state.project || txStart) return;
    const { past, future } = state.history;
    if (!past.length) return;
    lastCoalesce = null;
    const prev = past[past.length - 1];
    set(withDoc(state, prev, { past: past.slice(0, -1), future: [...future, state.project.doc] }));
  },
  redo() {
    if (!state.project || txStart) return;
    const { past, future } = state.history;
    if (!future.length) return;
    lastCoalesce = null;
    const next = future[future.length - 1];
    set(withDoc(state, next, { past: pushPast(past, state.project.doc), future: future.slice(0, -1) }));
  },

  // ----- selection (not in history) -----
  select(ids: string[], anchor?: string | null) {
    set({ ...state, selection: ids, anchorId: anchor !== undefined ? anchor : ids[0] ?? null });
  },
  clearSelection() {
    if (!state.selection.length && !state.anchorId) return;
    set({ ...state, selection: [], anchorId: null });
  },
  selectAll() {
    if (!state.project) return;
    set({ ...state, selection: state.project.doc.lines.map((l) => l.id) });
  },
  /** Cmd/Ctrl-click: toggle one id in the selection; it becomes the anchor. */
  toggle(id: string) {
    const has = state.selection.includes(id);
    set({
      ...state,
      selection: has ? state.selection.filter((x) => x !== id) : [...state.selection, id],
      anchorId: id,
    });
  },
  /** Shift-click: select the line range between the anchor (or first selected / `id`) and `id`. */
  selectRange(id: string) {
    if (!state.project) return;
    const lines = state.project.doc.lines;
    const to = lines.findIndex((l) => l.id === id);
    if (to < 0) return;
    const anchor = lines.findIndex((l) => l.id === (state.anchorId ?? state.selection[0] ?? id));
    const from = anchor < 0 ? to : anchor;
    const [a, b] = from <= to ? [from, to] : [to, from];
    set({ ...state, selection: lines.slice(a, b + 1).map((l) => l.id), anchorId: lines[from].id });
  },
  setCursor(id: string | null) {
    if (state.cursorId === id) return;
    set({ ...state, cursorId: id });
  },

  /** Record that `doc` is what the server now has (and optionally its version). dirty is recomputed against the current doc. */
  markSaved(doc: Doc, serverVersion?: number) {
    if (!state.project) return;
    const project = serverVersion !== undefined ? { ...state.project, serverVersion } : state.project;
    const savedDocJson = docKey(doc);
    set({ ...state, project, savedDocJson, dirty: docKey(project.doc) !== savedDocJson });
  },

  canUndo: () => state.history.past.length > 0,
  canRedo: () => state.history.future.length > 0,
};

/** Subscribe a component to a slice. Use shallowEqual as isEqual when the selector builds new objects. */
export function useStore<T>(selector: (s: EditorState) => T, isEqual?: (a: T, b: T) => boolean): T {
  return useExternalSelector(store.subscribe, store.getState, selector, isEqual);
}

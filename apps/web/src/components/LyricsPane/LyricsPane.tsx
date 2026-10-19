import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Doc } from '../../domain/types';
import * as ops from '../../domain/ops';
import { store, useStore } from '../../state/store';
import { playback, usePlayback } from '../../state/playback';
import * as cmd from '../../state/commands';
import { LyricRow, type DropZone } from './LyricRow';
import styles from './LyricsPane.module.css';

const LINE_MIME = 'application/x-lyric-line';

/** Editorial hints only: overlap with another segment, or starting before the previous line's start. */
function computeWarnings(doc: Doc): Map<string, string> {
  const out = new Map<string, string>();
  const add = (id: string, msg: string) => out.set(id, out.has(id) ? `${out.get(id)}; ${msg}` : msg);
  const timed = doc.lines
    .map((l, i) => ({ id: l.id, i, s: doc.segments[l.id] }))
    .filter((x) => x.s);
  let prev: (typeof timed)[number] | null = null;
  for (const x of timed) {
    if (prev && x.s.startMs < prev.s.startMs) add(x.id, 'starts before the previous timed line');
    prev = x;
  }
  const byStart = timed.slice().sort((a, b) => a.s.startMs - b.s.startMs || a.i - b.i);
  let holder: (typeof timed)[number] | null = null;
  for (const x of byStart) {
    if (holder && x.s.startMs < holder.s.endMs) {
      add(x.id, `overlaps line ${holder.i + 1}`);
      add(holder.id, `overlaps line ${x.i + 1}`);
    }
    if (!holder || x.s.endMs > holder.s.endMs) holder = x;
  }
  return out;
}

export function LyricsPane() {
  const doc = useStore((s) => s.project?.doc ?? null);
  const selection = useStore((s) => s.selection);
  const cursorId = useStore((s) => s.cursorId);
  const activeIndex = usePlayback(
    useCallback((s) => (doc ? ops.lineAt(doc, s.ms) : -1), [doc]),
  );
  const [tapOffset, setTapOffset] = cmd.useTapOffset();

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string | null; over: string | null; zone: DropZone | null }>({ id: null, over: null, zone: null });
  const listRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);

  const selSet = useMemo(() => new Set(selection), [selection]);
  const warnings = useMemo(() => (doc ? computeWarnings(doc) : new Map<string, string>()), [doc]);
  const placed = doc ? doc.lines.filter((l) => doc.segments[l.id]).length : 0;

  useEffect(() => cmd.onEditRequest(setEditingId), []);

  // Keep the cursor ("next to stamp") visible.
  useEffect(() => {
    if (!cursorId) return;
    listRef.current?.querySelector(`[data-line-id="${CSS.escape(cursorId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursorId]);

  // Keep the keyboard focus line visible while moving through the list.
  useEffect(() => {
    const id = cmd.getFocusId();
    if (!id) return;
    listRef.current?.querySelector(`[data-line-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  const onClick = useCallback((e: React.MouseEvent, id: string) => {
    if (e.shiftKey) store.selectRange(id);
    else if (e.metaKey || e.ctrlKey) store.toggle(id);
    else store.select([id], id);
    cmd.setFocusId(id);
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
    const seg = store.getState().project?.doc.segments[id];
    // Timed line: audition it. Untimed line: it becomes the stamp cursor.
    if (seg) playback.playRange(seg.startMs, seg.endMs);
    else store.setCursor(id);
  }, []);

  const onCommitEdit = useCallback((id: string, text: string | null) => {
    if (text !== null) cmd.editLineText(id, text);
    else cmd.cancelLineEdit(id);
    setEditingId(null);
  }, []);

  const clearDrag = useCallback(() => {
    dragId.current = null;
    setDrag({ id: null, over: null, zone: null });
  }, []);

  const onDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.dataTransfer.setData(LINE_MIME, id);
    e.dataTransfer.setData('text/plain', store.getState().project?.doc.lines.find((l) => l.id === id)?.text ?? '');
    e.dataTransfer.effectAllowed = 'copyMove';
    dragId.current = id;
    setDrag({ id, over: null, zone: null });
  }, []);

  const onDragOver = useCallback((e: React.DragEvent, id: string) => {
    if (!dragId.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragId.current === id) {
      setDrag((d) => (d.over === null ? d : { ...d, over: null, zone: null }));
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const zone: DropZone = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'merge';
    setDrag((d) => (d.over === id && d.zone === zone ? d : { ...d, over: id, zone }));
  }, []);

  const onDrop = useCallback((e: React.DragEvent, targetId: string) => {
    const from = dragId.current;
    const p = store.getState().project;
    const zone = drag.over === targetId ? drag.zone : null;
    clearDrag();
    if (!from || !p || from === targetId || !zone) return;
    e.preventDefault();
    const lines = p.doc.lines;
    const fi = lines.findIndex((l) => l.id === from);
    const ti = lines.findIndex((l) => l.id === targetId);
    if (fi < 0 || ti < 0) return;
    if (zone === 'merge') {
      // Earlier line (by order) keeps its id and comes first in the merged text.
      const [a, b] = fi < ti ? [from, targetId] : [targetId, from];
      store.apply((d) => ops.merge(d, a, b));
      store.select([a], a);
    } else {
      const slot = zone === 'before' ? ti : ti + 1; // insertion slot in the original order
      const to = fi < slot ? slot - 1 : slot;
      store.apply((d) => ops.reorder(d, from, to));
      store.select([from], from);
    }
  }, [drag, clearDrag]);

  const replaceSheet = () => {
    const p = store.getState().project;
    if (!p) return;
    const next = ops.replaceSheet(p.doc, pasteText);
    const keep = new Set(next.lines.map((l) => l.id));
    const lost = p.doc.lines.filter((l) => p.doc.segments[l.id] && !keep.has(l.id)).length;
    if (lost > 0 && !window.confirm(`Replacing the sheet will discard timing on ${lost} line${lost === 1 ? '' : 's'}. Continue? (Undo is available.)`)) return;
    store.apply((d) => ops.replaceSheet(d, pasteText));
    setPasteOpen(false);
  };

  const appendSheet = () => {
    const texts = ops.parseLyricSheet(pasteText);
    if (!texts.length) return;
    store.apply((d) => ops.appendLines(d, texts));
    setPasteText('');
    setPasteOpen(false);
  };

  const togglePaste = () => {
    if (!pasteOpen && doc) setPasteText(doc.lines.map((l) => l.text).join('\n'));
    setPasteOpen(!pasteOpen);
  };

  return (
    <section className={styles.pane} aria-label="Lyrics pane">
      <header className={styles.header}>
        <h2 className={styles.title}>
          Lines · <span data-testid="line-count">{doc?.lines.length ?? 0}</span> ·{' '}
          <span data-testid="placed-count">{placed}</span> placed
        </h2>
        <div className={styles.tools}>
          <label className={styles.offset} title="Taps usually land 100-200 ms late. This is subtracted from every stamp.">
            Tap offset
            <input
              type="number"
              min={0}
              max={cmd.MAX_TAP_OFFSET_MS}
              step={10}
              value={tapOffset}
              onChange={(e) => setTapOffset(Number(e.target.value))}
              aria-label="Tap offset (ms)"
            />
            <span aria-hidden="true">ms</span>
          </label>
          <button type="button" onClick={togglePaste} aria-expanded={pasteOpen} disabled={!doc}>
            {pasteOpen ? 'Hide paste box' : 'Paste lyrics'}
          </button>
          <button type="button" onClick={() => cmd.addLineAfterSelection()} disabled={!doc}>
            + Add line
          </button>
        </div>
      </header>

      {pasteOpen && (
        <div className={styles.paste}>
          <textarea
            aria-label="Lyrics sheet"
            rows={6}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="One line per row. Blank lines and lines starting with # are ignored."
          />
          <div className={styles.pasteActions}>
            <button type="button" onClick={replaceSheet}>Replace sheet</button>
            <button type="button" onClick={appendSheet}>Append</button>
            <span className={styles.hint}>Unchanged lines keep their timing when replacing.</span>
          </div>
        </div>
      )}

      <div ref={listRef} className={styles.list} role="listbox" aria-multiselectable="true" aria-label="Lyrics">
        {doc && doc.lines.length === 0 && (
          <p className={styles.empty}>No lines yet. Use “Paste lyrics” or “+ Add line”.</p>
        )}
        {doc?.lines.map((line, i) => (
          <LyricRow
            key={line.id}
            index={i}
            line={line}
            seg={doc.segments[line.id]}
            selected={selSet.has(line.id)}
            isCursor={cursorId === line.id}
            isActive={activeIndex === i}
            warning={warnings.get(line.id)}
            editing={editingId === line.id}
            dropZone={drag.over === line.id ? drag.zone : null}
            dragging={drag.id === line.id}
            onClick={onClick}
            onStartEdit={setEditingId}
            onCommitEdit={onCommitEdit}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={clearDrag}
          />
        ))}
      </div>
    </section>
  );
}

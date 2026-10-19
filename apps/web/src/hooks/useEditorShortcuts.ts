import { useEffect, useRef } from 'react';
import { store } from '../state/store';
import { view } from '../state/view';
import { playback } from '../state/playback';
import * as cmd from '../state/commands';

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * One document-level keydown listener for the whole editor. Key map: components/ShortcutsHelp/shortcuts.ts.
 * Ignored while typing in a field (Esc blurs it) and while a modal is open (Esc closes it); Cmd/Ctrl+S is
 * honoured even inside a field because the browser's own "save page" is never wanted.
 */
export function useEditorShortcuts(opts: { onSave: () => void }): void {
  const onSave = useRef(opts.onSave);
  onSave.current = opts.onSave;

  useEffect(() => {
    let spaceHandled = false;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;
      const lower = key.length === 1 ? key.toLowerCase() : key;
      const handled = () => e.preventDefault();

      if (view.getState().modal !== null) {
        if (key === 'Escape') {
          handled();
          view.openModal(null);
        }
        return;
      }

      if (mod && lower === 's' && !e.altKey) {
        handled();
        onSave.current();
        return;
      }

      if (isEditable(e.target)) {
        if (key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }

      // ---- with Cmd/Ctrl ----
      if (mod && !e.altKey) {
        if (lower === 'z') {
          handled();
          if (e.shiftKey) cmd.redo();
          else cmd.undo();
        } else if (lower === 'y') {
          handled();
          cmd.redo();
        } else if (lower === 'a') {
          handled();
          store.selectAll();
        } else if (lower === 'o') {
          handled();
          view.openModal('load');
        }
        return;
      }

      const hasSel = store.getState().selection.length > 0;
      const step = e.shiftKey ? 100 : 10;

      switch (key) {
        case ' ':
          handled();
          spaceHandled = true;
          if (!e.repeat) playback.toggle();
          return;
        case 'Enter':
          handled();
          if (!e.repeat) cmd.stampNext();
          return;
        case 'ArrowLeft':
        case 'ArrowRight': {
          handled();
          const dir = key === 'ArrowLeft' ? -1 : 1;
          if (e.altKey) cmd.nudge(dir * step, 'start');
          else if (hasSel) cmd.nudge(dir * step, 'both');
          else cmd.seekBy(dir * (e.shiftKey ? 5000 : 1000));
          return;
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          handled();
          const dir = key === 'ArrowUp' ? -1 : 1;
          if (e.altKey) cmd.moveSelected(dir);
          else cmd.moveFocus(dir, e.shiftKey);
          return;
        }
        case 'Backspace':
        case 'Delete':
          handled();
          if (e.shiftKey) cmd.deleteSelected();
          else cmd.clearSelectedTiming();
          return;
        case 'Escape':
          store.clearSelection();
          return;
        case 'F2':
          handled();
          cmd.requestEdit();
          return;
        case '+':
        case '=':
          handled();
          view.zoomBy(1.25);
          return;
        case '-':
        case '_':
          handled();
          view.zoomBy(1 / 1.25);
          return;
        case '?':
          handled();
          view.openModal('shortcuts');
          return;
      }

      // End-edge nudge: brackets (physical keys, so Shift does not change the code).
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        handled();
        cmd.nudge((e.code === 'BracketLeft' ? -1 : 1) * step, 'end');
        return;
      }

      if (e.altKey) return;
      switch (lower) {
        case 'j':
          handled();
          if (!e.repeat) cmd.stampNext();
          return;
        case 'k':
          handled();
          if (!e.repeat) cmd.stampEndCurrent();
          return;
        case 'p':
          handled();
          if (!e.repeat) cmd.playSelection();
          return;
        case 'm':
          handled();
          if (!e.repeat) cmd.mergeSelected();
          return;
        case 's':
          handled();
          if (!e.repeat) cmd.splitAtPlayhead();
          return;
      }
    };

    // A focused <button> would otherwise also "click" on Space keyup.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && spaceHandled) {
        spaceHandled = false;
        if (!isEditable(e.target) && view.getState().modal === null) e.preventDefault();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, []);
}

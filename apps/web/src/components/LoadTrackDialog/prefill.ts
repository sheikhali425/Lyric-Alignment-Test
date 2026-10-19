import { useEffect } from 'react';
import { view } from '../../state/view';

/** An audio file dropped on the window, handed to the dialog (consumed once when it opens). */
let pending: File | null = null;
export const takePendingAudio = (): File | null => {
  const f = pending;
  pending = null;
  return f;
};

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

/** Drop an audio file anywhere on the window to open "Load song" prefilled with it. */
export function useWindowAudioDrop(): void {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault(); // allow drop (and stop the browser navigating to the file)
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|oga|flac|aac|opus|weba)$/i.test(f.name));
      if (!file) return;
      pending = file;
      if (view.getState().modal === 'load') {
        view.openModal(null); // re-open so the dialog remounts and picks the file up
        queueMicrotask(() => view.openModal('load'));
      } else {
        view.openModal('load');
      }
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
}

import { useCallback } from 'react';
import type { Doc } from '../../domain/types';
import { lineAt } from '../../domain/ops';
import { useStore } from '../../state/store';
import { usePlayback } from '../../state/playback';
import styles from './Karaoke.module.css';

/**
 * Index shown as "current" and whether it is really playing (vs. the upcoming line in a gap, or the
 * last line already sung once the playhead is past every timed line). -1 if nothing is timed.
 */
function pick(doc: Doc, ms: number): { idx: number; live: boolean } {
  const at = lineAt(doc, ms);
  if (at >= 0) return { idx: at, live: true };
  let best = -1;
  let bestStart = Infinity;
  let last = -1;
  let lastEnd = -Infinity;
  doc.lines.forEach((l, i) => {
    const s = doc.segments[l.id];
    if (!s) return;
    if (s.startMs > ms && s.startMs < bestStart) {
      best = i;
      bestStart = s.startMs;
    }
    if (s.endMs <= ms && s.endMs > lastEnd) {
      last = i;
      lastEnd = s.endMs;
    }
  });
  return { idx: best >= 0 ? best : last, live: false };
}

export function Karaoke() {
  const doc = useStore((s) => s.project?.doc ?? null);
  // The selector returns {idx, live}; shallowEqual (default) keeps this from re-rendering every frame.
  const { idx, live } = usePlayback(useCallback((s) => (doc ? pick(doc, s.ms) : { idx: -1, live: false }), [doc]));
  const lines = doc?.lines ?? [];
  return (
    <div className={styles.karaoke} role="region" aria-label="Karaoke readout">
      {idx < 0 ? (
        <p className={styles.empty}>Stamp some lines to see them here.</p>
      ) : (
        <>
          <p className={styles.side} data-slot="prev">{lines[idx - 1]?.text ?? ' '}</p>
          <p className={`${styles.current} ${live ? styles.live : styles.upcoming}`} data-slot="current" aria-live="off">
            {lines[idx].text}
          </p>
          <p className={styles.side} data-slot="next">{lines[idx + 1]?.text ?? ' '}</p>
        </>
      )}
    </div>
  );
}

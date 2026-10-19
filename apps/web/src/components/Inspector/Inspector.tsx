import { useMemo, useState } from 'react';
import { formatMs, parseTime } from '../../domain/time';
import { useStore, shallowEqual } from '../../state/store';
import * as cmd from '../../state/commands';
import { TimeField } from './TimeField';
import styles from './Inspector.module.css';

const STEPS = [-100, -10, 10, 100];
const fmtStep = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;

function NudgeRow({ label, edge }: { label: string; edge: 'both' | 'start' | 'end' }) {
  return (
    <div className={styles.nudgeRow}>
      <span className={styles.nudgeLabel}>{label}</span>
      {STEPS.map((n) => (
        <button key={n} type="button" onClick={() => cmd.nudge(n, edge)} aria-label={`${label} ${n > 0 ? '+' : '−'}${Math.abs(n)} ms`}>
          {fmtStep(n)}
        </button>
      ))}
    </div>
  );
}

/** Parse "+250", "-1500" (ms) or "+0:01.500", "-1.5" (time). Returns signed ms or null. */
export function parseShift(input: string): number | null {
  const m = /^\s*([+\-−]?)\s*(.+?)\s*$/.exec(input);
  if (!m) return null;
  const sign = m[1] === '-' || m[1] === '−' ? -1 : 1;
  const body = m[2];
  if (/^\d+$/.test(body)) return sign * Number(body);
  const t = parseTime(body);
  return t === null ? null : sign * t;
}

function SplitPicker({ id, text }: { id: string; text: string }) {
  const parts = useMemo(() => {
    const out: { word: string; end: number }[] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push({ word: m[0], end: m.index + m[0].length });
    return out;
  }, [text]);
  if (parts.length < 2) return null;
  return (
    <div className={styles.split} role="group" aria-label="Choose where to split the text">
      {parts.map((p, i) => (
        <span key={i} className={styles.splitWord}>
          {p.word}
          {i < parts.length - 1 && (
            <button
              type="button"
              className={styles.gap}
              title="Split here (at the playhead)"
              aria-label={`Split between "${p.word}" and "${parts[i + 1].word}"`}
              onClick={() => cmd.splitAtPlayhead({ id, textPos: p.end })}
            >
              |
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

function Single({ id }: { id: string }) {
  const line = useStore((s) => s.project?.doc.lines.find((l) => l.id === id));
  const seg = useStore((s) => s.project?.doc.segments[id]);
  const hasNext = useStore((s) => {
    const ls = s.project?.doc.lines;
    return !!ls && ls.findIndex((l) => l.id === id) < ls.length - 1;
  });
  if (!line) return null;
  return (
    <div className={styles.body}>
      <blockquote className={styles.quote}>“{line.text}”</blockquote>
      <div className={styles.fields}>
        <TimeField label="Start" value={seg?.startMs ?? null} onCommit={(ms) => cmd.setEdge(id, 'start', ms)} />
        <TimeField label="End" value={seg?.endMs ?? null} onCommit={(ms) => cmd.setEdge(id, 'end', ms)} />
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Duration</span>
          <output className={styles.readout}>{seg ? formatMs(seg.endMs - seg.startMs) : '—'}</output>
        </div>
      </div>
      {seg ? (
        <>
          <NudgeRow label="Start" edge="start" />
          <NudgeRow label="End" edge="end" />
          <NudgeRow label="Both" edge="both" />
        </>
      ) : (
        <p className={styles.note}>Untimed. Stamp it (Enter) or set Start / End above.</p>
      )}
      <div className={styles.actions}>
        <button type="button" onClick={cmd.playSelection} disabled={!seg}>Play</button>
        <button type="button" onClick={() => cmd.setEdgeToPlayhead(id, 'start')}>Set start to playhead</button>
        <button type="button" onClick={() => cmd.setEdgeToPlayhead(id, 'end')}>Set end to playhead</button>
        <button type="button" onClick={() => cmd.splitAtPlayhead({ id })}>Split at playhead</button>
        <button type="button" onClick={cmd.mergeSelected} disabled={!hasNext}>Merge with next</button>
        <button type="button" onClick={cmd.clearSelectedTiming} disabled={!seg}>Clear timing</button>
        <button type="button" className={styles.danger} onClick={cmd.deleteSelected}>Delete line</button>
      </div>
      <SplitPicker id={id} text={line.text} />
    </div>
  );
}

function Multi({ ids }: { ids: string[] }) {
  const span = useStore(
    (s) => {
      const segs = ids.map((id) => s.project?.doc.segments[id]).filter((x) => !!x);
      return segs.length
        ? { timed: segs.length, start: Math.min(...segs.map((x) => x!.startMs)), end: Math.max(...segs.map((x) => x!.endMs)) }
        : { timed: 0, start: 0, end: 0 };
    },
    shallowEqual,
  );
  const [shiftText, setShiftText] = useState('');
  const [bad, setBad] = useState(false);
  const applyShift = () => {
    const d = parseShift(shiftText);
    if (d === null) {
      setBad(true);
      return;
    }
    setBad(false);
    cmd.shiftSelected(d);
    setShiftText('');
  };
  return (
    <div className={styles.body}>
      <p className={styles.multi}>{ids.length} lines selected — edits apply to all</p>
      <p className={styles.note}>
        {span.timed
          ? `${span.timed} timed · span ${formatMs(span.start)} – ${formatMs(span.end)} (${formatMs(span.end - span.start)})`
          : 'None of the selected lines is timed.'}
      </p>
      <div className={styles.shiftRow}>
        <label>
          <span className={styles.fieldLabel}>Shift by</span>
          <input
            className={`${styles.time} ${bad ? styles.invalid : ''}`}
            value={shiftText}
            placeholder="+250 or -0:01.500"
            aria-invalid={bad || undefined}
            onChange={(e) => {
              setShiftText(e.target.value);
              setBad(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyShift();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setShiftText('');
                (e.target as HTMLElement).blur();
              }
            }}
          />
        </label>
        <button type="button" onClick={applyShift}>Apply</button>
      </div>
      {bad && <span role="alert" className={styles.error}>Use ms (+250) or m:ss.mmm (-0:01.500)</span>}
      <NudgeRow label="All" edge="both" />
      <div className={styles.actions}>
        <button type="button" onClick={cmd.playSelection} disabled={!span.timed}>Play</button>
        <button type="button" onClick={cmd.mergeSelected}>Merge</button>
        <button type="button" onClick={cmd.clearSelectedTiming}>Clear timing</button>
        <button type="button" className={styles.danger} onClick={cmd.deleteSelected}>Delete lines</button>
      </div>
    </div>
  );
}

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const ids = selection;
  return (
    <aside className={styles.inspector} aria-label="Inspector">
      <h2 className={styles.title}>Inspector</h2>
      {ids.length === 0 && (
        <div className={styles.body}>
          <p className={styles.note}>Select a line to edit its timing.</p>
          <ul className={styles.help}>
            <li><kbd>Space</kbd> play / pause</li>
            <li><kbd>Enter</kbd> stamp the next line's start</li>
            <li><kbd>K</kbd> stamp the end of the last line</li>
            <li><kbd>←</kbd> <kbd>→</kbd> nudge selection (seek if none)</li>
            <li><kbd>⌘/Ctrl+Z</kbd> undo · <kbd>?</kbd> all shortcuts</li>
          </ul>
        </div>
      )}
      {ids.length === 1 && <Single key={ids[0]} id={ids[0]} />}
      {ids.length > 1 && <Multi ids={ids} />}
    </aside>
  );
}

import { memo, useEffect, useRef } from 'react';
import type { Line, Segment } from '../../domain/types';
import { formatMs } from '../../domain/time';
import styles from './LyricsPane.module.css';

export type DropZone = 'before' | 'after' | 'merge';

interface Props {
  index: number;
  line: Line;
  seg: Segment | undefined;
  selected: boolean;
  isCursor: boolean;
  isActive: boolean;
  warning: string | undefined;
  editing: boolean;
  dropZone: DropZone | null;
  dragging: boolean;
  onClick: (e: React.MouseEvent, id: string) => void;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, text: string | null) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
}

function LyricRowImpl(p: Props) {
  const { line, seg, index } = p;
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    if (p.editing) {
      done.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [p.editing]);

  const name = `${index + 1}. ${line.text}${seg ? `, starts ${formatMs(seg.startMs)}` : ', untimed'}`;
  const cls = [
    styles.row,
    seg ? styles.timed : styles.untimed,
    p.selected && styles.selected,
    p.isCursor && styles.cursor,
    p.isActive && styles.active,
    p.dragging && styles.dragging,
    p.dropZone === 'before' && styles.dropBefore,
    p.dropZone === 'after' && styles.dropAfter,
    p.dropZone === 'merge' && styles.dropMerge,
  ]
    .filter(Boolean)
    .join(' ');

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    p.onCommitEdit(line.id, commit ? inputRef.current?.value ?? null : null);
  };

  return (
    <div
      role="option"
      aria-selected={p.selected}
      aria-label={name}
      aria-current={p.isActive ? 'true' : undefined}
      data-line-id={line.id}
      data-timed={seg ? 'true' : 'false'}
      data-cursor={p.isCursor ? 'true' : undefined}
      data-active={p.isActive ? 'true' : undefined}
      className={cls}
      draggable={!p.editing}
      onClick={(e) => p.onClick(e, line.id)}
      onDoubleClick={() => p.onStartEdit(line.id)}
      onDragStart={(e) => p.onDragStart(e, line.id)}
      onDragOver={(e) => p.onDragOver(e, line.id)}
      onDrop={(e) => p.onDrop(e, line.id)}
      onDragEnd={p.onDragEnd}
    >
      <span className={styles.marker} title={p.isCursor ? 'Next to stamp' : undefined} aria-hidden="true">
        {p.isCursor ? '▶' : ''}
      </span>
      <span className={styles.num} aria-hidden="true">{index + 1}</span>
      {p.editing ? (
        <input
          ref={inputRef}
          className={styles.edit}
          aria-label={`Edit line ${index + 1}`}
          defaultValue={line.text}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              finish(true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              finish(false);
            }
          }}
        />
      ) : (
        <span className={styles.text}>{line.text}</span>
      )}
      <span className={styles.meta}>
      {p.warning && (
        <span className={styles.warn} title={p.warning} role="img" aria-label={`Warning: ${p.warning}`}>
          ⚠
        </span>
      )}
      {p.isCursor && <span className={styles.nextTag}>next</span>}
      {seg ? (
        <span className={styles.time}>{formatMs(seg.startMs)}</span>
      ) : (
        <span className={styles.badge}>untimed</span>
      )}
      </span>
    </div>
  );
}

export const LyricRow = memo(LyricRowImpl);

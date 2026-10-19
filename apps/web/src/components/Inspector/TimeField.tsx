import { useEffect, useId, useState } from 'react';
import { formatMs, parseTime } from '../../domain/time';
import styles from './Inspector.module.css';

interface Props {
  label: string;
  value: number | null;
  onCommit: (ms: number) => void;
}

/** "m:ss.mmm" input. Enter/blur commits; Escape or an invalid value reverts (invalid also shows an inline error). */
export function TimeField({ label, value, onCommit }: Props) {
  const shown = value === null ? '' : formatMs(value);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState(false);
  const errId = useId();

  useEffect(() => {
    setDraft(shown);
    setError(false);
  }, [shown]);

  const commit = (revertOnInvalid: boolean) => {
    if (draft.trim() === shown) {
      setError(false);
      return;
    }
    const ms = parseTime(draft);
    if (ms === null) {
      setError(true);
      if (revertOnInvalid) setDraft(shown);
      return;
    }
    setError(false);
    onCommit(ms);
  };

  return (
    <div className={styles.field}>
      <label>
        <span className={styles.fieldLabel}>{label}</span>
        <input
          className={`${styles.time} ${error ? styles.invalid : ''}`}
          value={draft}
          placeholder="m:ss.mmm"
          spellCheck={false}
          inputMode="decimal"
          aria-invalid={error || undefined}
          aria-describedby={error ? errId : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(false);
          }}
          onBlur={() => commit(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(false);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setDraft(shown);
              setError(false);
              (e.target as HTMLElement).blur();
            }
          }}
        />
      </label>
      {error && (
        <span id={errId} role="alert" className={styles.error}>
          Use m:ss.mmm, e.g. 1:23.450
        </span>
      )}
    </div>
  );
}

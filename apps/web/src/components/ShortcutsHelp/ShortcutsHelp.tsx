import { useEffect, useRef } from 'react';
import { view, useView } from '../../state/view';
import { SHORTCUT_GROUPS } from './shortcuts';
import styles from './ShortcutsHelp.module.css';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ShortcutsHelp() {
  const open = useView((s) => s.modal === 'shortcuts');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      view.openModal(null);
      return;
    }
    if (e.key !== 'Tab') return;
    const els = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!els || !els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && view.openModal(null)}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onKeyDown={onKeyDown}>
        <header className={styles.head}>
          <h2>Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" onClick={() => view.openModal(null)} aria-label="Close shortcuts">
            Close
          </button>
        </header>
        <div className={styles.body}>
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl className={styles.list}>
                {g.items.map((it) => (
                  <div key={it.description} className={styles.row}>
                    <dt>
                      {it.keys.map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className={styles.or}> or </span>}
                          <kbd>{k}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd>{it.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

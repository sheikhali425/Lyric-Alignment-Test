import { useEffect, useMemo, useRef } from 'react';
import type { Doc } from '../../domain/types';
import { formatMs } from '../../domain/time';
import { type ConflictInfo, cancelConflict, resolveKeepMine, resolveUseServer, useSession } from '../../state/session';
import { useStore } from '../../state/store';
import s from './ConflictDialog.module.css';

export interface DocDiff {
  added: string[];
  removed: string[];
  edited: { from: string; to: string }[];
  retimed: { text: string; mine: string; server: string }[];
}

const fmt = (seg?: { startMs: number; endMs: number }) => (seg ? `${formatMs(seg.startMs)} – ${formatMs(seg.endMs)}` : 'untimed');

/** Diff by line id (never by text): mine -> server. */
export function diffDocs(mine: Doc, server: Doc): DocDiff {
  const m = new Map(mine.lines.map((l) => [l.id, l]));
  const sv = new Map(server.lines.map((l) => [l.id, l]));
  const d: DocDiff = { added: [], removed: [], edited: [], retimed: [] };
  for (const l of server.lines) if (!m.has(l.id)) d.added.push(l.text);
  for (const l of mine.lines) {
    const o = sv.get(l.id);
    if (!o) {
      d.removed.push(l.text);
      continue;
    }
    if (o.text !== l.text) d.edited.push({ from: l.text, to: o.text });
    const a = mine.segments[l.id];
    const b = server.segments[l.id];
    if ((a?.startMs ?? -1) !== (b?.startMs ?? -1) || (a?.endMs ?? -1) !== (b?.endMs ?? -1)) {
      d.retimed.push({ text: l.text, mine: fmt(a), server: fmt(b) });
    }
  }
  return d;
}

const CAP = 12;

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <section className={s.sec}>
      <h3>{title} ({count})</h3>
      <ul>{children}</ul>
      {count > CAP && <p className={s.more}>…and {count - CAP} more</p>}
    </section>
  );
}

export function ConflictDialog() {
  const conflict = useSession((st) => st.conflict);
  return conflict ? <Body conflict={conflict} /> : null;
}

function Body({ conflict }: { conflict: ConflictInfo }) {
  const mine = useStore((st) => st.project?.doc ?? null);
  const ref = useRef<HTMLDivElement>(null);
  const diff = useMemo(() => (mine ? diffDocs(mine, conflict.server.doc) : null), [mine, conflict]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelConflict();
    } else if (e.key === 'Tab') {
      const els = Array.from(ref.current?.querySelectorAll<HTMLElement>('button') ?? []);
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const identical = diff && !diff.added.length && !diff.removed.length && !diff.edited.length && !diff.retimed.length;

  return (
    <div className={s.backdrop}>
      <div ref={ref} className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="conflict-title" onKeyDown={onKeyDown}>
        <h2 id="conflict-title">Someone else changed this track</h2>
        <p className={s.lead}>
          The server has version {conflict.server.version} (you started from {conflict.baseVersion}). Choose which one to keep.
        </p>
        {diff && (
          <div className={s.diff} aria-label="Differences between your version and the server's">
            {identical && <p>The content is identical; only the version number moved on.</p>}
            <Section title="Lines only on the server" count={diff.added.length}>
              {diff.added.slice(0, CAP).map((t, i) => <li key={i} className={s.add}>{t}</li>)}
            </Section>
            <Section title="Lines only in your version" count={diff.removed.length}>
              {diff.removed.slice(0, CAP).map((t, i) => <li key={i} className={s.rem}>{t}</li>)}
            </Section>
            <Section title="Text changed on the server" count={diff.edited.length}>
              {diff.edited.slice(0, CAP).map((e, i) => (
                <li key={i}><span className={s.rem}>{e.from}</span><br /><span className={s.add}>{e.to}</span></li>
              ))}
            </Section>
            <Section title="Timings that differ" count={diff.retimed.length}>
              {diff.retimed.slice(0, CAP).map((r, i) => (
                <li key={i}>
                  {r.text}
                  <br />
                  <small>mine {r.mine} · server {r.server}</small>
                </li>
              ))}
            </Section>
          </div>
        )}
        <div className={s.actions}>
          <button type="button" onClick={cancelConflict}>Cancel</button>
          <button type="button" onClick={resolveUseServer}>Use server's</button>
          <button type="button" className={s.primary} onClick={() => void resolveKeepMine()}>Keep mine</button>
        </div>
      </div>
    </div>
  );
}

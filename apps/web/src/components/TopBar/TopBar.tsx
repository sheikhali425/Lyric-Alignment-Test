import { toLrc } from '../../domain/lrc';
import { formatMs, formatShort } from '../../domain/time';
import { redo, undo } from '../../state/commands';
import { playback, usePlayback } from '../../state/playback';
import { saveCurrent, useSession } from '../../state/session';
import { store, useStore } from '../../state/store';
import { view } from '../../state/view';
import { toast } from '../Toast/toastStore';
import s from './TopBar.module.css';

/** Isolated so per-frame playback updates re-render only these tiny components. */
function PlayButton() {
  const playing = usePlayback((p) => p.playing);
  return (
    <button type="button" className={s.play} aria-label={playing ? 'Pause' : 'Play'} onClick={() => playback.toggle()}>
      {playing ? '❚❚' : '▶'}
    </button>
  );
}

function TimeReadout({ durationMs }: { durationMs: number }) {
  // The decoded audio can run a few ms past the track's stated duration; never show "2:05.009 / 2:04".
  const ms = Math.min(usePlayback((p) => p.ms), durationMs);
  return (
    <span className={s.time} aria-label="Current time" title={`${formatMs(ms)} of ${formatMs(durationMs)}`}>
      {formatMs(ms)} <span className={s.muted}>/ {formatShort(durationMs)}</span>
    </span>
  );
}

function SaveControls() {
  const dirty = useStore((st) => st.dirty);
  const source = useStore((st) => st.project?.source ?? 'server');
  const status = useSession((st) => st.status);
  const label =
    status === 'saving' ? 'Saving…'
    : status === 'conflict' ? 'Conflict'
    : status === 'error' ? 'Save failed'
    : dirty ? 'Unsaved changes'
    : 'Saved';
  const tone = status === 'conflict' || status === 'error' ? 'bad' : dirty || status === 'saving' ? 'warn' : 'ok';
  return (
    <>
      <span className={s.source} title={source === 'server' ? 'Saved to the server' : 'Saved in this browser only'}>
        {source === 'server' ? 'Server' : 'Local'}
      </span>
      <span className={`${s.status} ${s[tone]}`} role="status" data-testid="save-status">{label}</span>
      <button type="button" className={s.primary} disabled={status === 'saving'} onClick={() => void saveCurrent()}>
        Save
      </button>
    </>
  );
}

function UndoRedo() {
  const canUndo = useStore((st) => st.history.past.length > 0);
  const canRedo = useStore((st) => st.history.future.length > 0);
  return (
    <div className={s.group} role="group" aria-label="History">
      <button type="button" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={undo}>↶</button>
      <button type="button" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={redo}>↷</button>
    </div>
  );
}

export function exportLrc(): void {
  const project = store.getState().project;
  if (!project) return;
  const blob = new Blob([toLrc(project)], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  const safe = (project.title || 'lyrics').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'lyrics';
  a.href = URL.createObjectURL(blob);
  a.download = `${safe}.lrc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  if (!project.doc.lines.some((l) => project.doc.segments[l.id])) toast.warning('No lines are timed yet, so the LRC file only has headers.');
}

export function TopBar() {
  const title = useStore((st) => st.project?.title ?? '');
  const artist = useStore((st) => st.project?.artist ?? '');
  const durationMs = useStore((st) => st.project?.durationMs ?? 0);
  const has = useStore((st) => !!st.project);

  return (
    <header className={s.bar}>
      <button type="button" onClick={() => view.openModal('load')}>Load song</button>
      <div className={s.titleBlock}>
        <h1 className={s.title}>{title || 'Loading…'}</h1>
        {artist && <span className={s.artist}>{artist}</span>}
      </div>
      {has && (
        <>
          <PlayButton />
          <TimeReadout durationMs={durationMs} />
          <div className={s.group} role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => view.zoomBy(1 / 1.25)}>−</button>
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => view.zoomBy(1.25)}>+</button>
          </div>
          <UndoRedo />
        </>
      )}
      <span className={s.spacer} />
      {has && <SaveControls />}
      <button type="button" disabled={!has} onClick={exportLrc}>Export LRC</button>
      <button type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => view.openModal('shortcuts')}>?</button>
    </header>
  );
}

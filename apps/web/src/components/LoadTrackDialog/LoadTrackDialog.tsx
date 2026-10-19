import { useEffect, useMemo, useRef, useState } from 'react';
import { parseLyricSheet } from '../../domain/ops';
import { createLocalProject, deleteLocalProject, openProject, useSession } from '../../state/session';
import { useStore } from '../../state/store';
import { useView, view } from '../../state/view';
import { toast } from '../Toast/toastStore';
import { takePendingAudio } from './prefill';
import s from './LoadTrackDialog.module.css';

const stripExt = (n: string) => n.replace(/\.[^.]+$/, '');

export function LoadTrackDialog() {
  const open = useView((v) => v.modal === 'load');
  return open ? <Inner /> : null;
}

function Inner() {
  const projects = useSession((st) => st.projects);
  const activeKey = useStore((st) => st.project?.key ?? null);
  const [file, setFile] = useState<File | null>(() => takePendingAudio());
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState(() => (file ? stripExt(file.name) : ''));
  const [titleTouched, setTitleTouched] = useState(false);
  const [artist, setArtist] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const lineCount = useMemo(() => parseLyricSheet(lyrics).length, [lyrics]);
  const hasAudio = !!file || url.trim() !== '';
  const canCreate = hasAudio && lineCount > 0 && !busy;

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
  }, []);

  const close = () => view.openModal(null);

  const pickFile = (f: File | null) => {
    setFile(f);
    if (f) {
      setUrl('');
      if (!titleTouched) setTitle(stripExt(f.name));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // keep global editor shortcuts out of the dialog
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const els = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([type=file]), textarea, [tabindex="0"]') ?? [],
      );
      if (!els.length) return;
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

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      await createLocalProject({ title, artist, audio: file ?? url.trim(), lyricsText: lyrics });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const switchTo = async (key: string) => {
    if (key === activeKey) return close();
    if (await openProject(key)) close();
  };

  const remove = async (key: string, name: string) => {
    if (!window.confirm(`Delete "${name}" from this browser? Its audio, lyrics and timings will be removed.`)) return;
    try {
      await deleteLocalProject(key);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={dialogRef} className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="load-title" onKeyDown={onKeyDown}>
        <header className={s.head}>
          <h2 id="load-title">Load song</h2>
          <button type="button" className={s.x} aria-label="Close" onClick={close}>×</button>
        </header>

        <div className={s.body}>
          <section className={s.col} aria-label="New track">
            <h3>Bring a track</h3>
            <div
              className={`${s.drop} ${over ? s.over : ''}`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation(); // the window-level handler must not re-open the dialog
                setOver(false);
                const f = e.dataTransfer.files[0];
                if (f) pickFile(f);
              }}
            >
              <p>{file ? `Selected: ${file.name}` : 'Drop an audio file here, or'}</p>
              <label className={s.fileBtn}>
                Choose file
                <input
                  ref={fileRef}
                  className={s.file}
                  type="file"
                  accept="audio/*"
                  aria-label="Audio file"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <label className={s.field}>
              <span>Audio URL</span>
              <input
                type="url"
                inputMode="url"
                placeholder="https://example.com/song.mp3 (or use a file)"
                value={url}
                disabled={!!file}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            {file && (
              <button type="button" className={s.link} onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>
                Remove selected file
              </button>
            )}
            <div className={s.row}>
              <label className={s.field}>
                <span>Title</span>
                <input value={title} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }} />
              </label>
              <label className={s.field}>
                <span>Artist (optional)</span>
                <input value={artist} onChange={(e) => setArtist(e.target.value)} />
              </label>
            </div>
            <label className={s.field}>
              <span>Lyrics</span>
              <textarea rows={8} value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder={'Paste lyrics, one line per row.\nBlank lines and lines starting with # are ignored.'} />
            </label>
            <p className={s.count} aria-live="polite">{lineCount} {lineCount === 1 ? 'line' : 'lines'} found</p>
            {error && <p className={s.error} role="alert">{error}</p>}
            <div className={s.actions}>
              <button type="button" onClick={close}>Cancel</button>
              <button type="button" className={s.primary} disabled={!canCreate} onClick={() => void create()}>
                {busy ? 'Reading audio…' : 'Create'}
              </button>
            </div>
          </section>

          <section className={s.col} aria-label="Your projects">
            <h3>Projects</h3>
            <ul className={s.list}>
              {projects.map((p) => (
                <li key={p.key} className={s.item}>
                  <button type="button" className={s.pick} aria-current={p.key === activeKey ? 'true' : undefined} onClick={() => void switchTo(p.key)}>
                    <strong>{p.title}</strong>
                    <span>{p.artist ? `${p.artist} · ` : ''}{p.source === 'server' ? 'Server track' : 'Local'}{p.key === activeKey ? ' · open' : ''}</span>
                  </button>
                  {p.source === 'local' && (
                    <button type="button" className={s.del} aria-label={`Delete ${p.title}`} onClick={() => void remove(p.key, p.title)}>
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

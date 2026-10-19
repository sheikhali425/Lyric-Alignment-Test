import { useEffect, useRef } from 'react';
import { ConflictDialog } from './components/ConflictDialog';
import { Inspector } from './components/Inspector';
import { Karaoke } from './components/Karaoke';
import { LoadTrackDialog, useWindowAudioDrop } from './components/LoadTrackDialog';
import { LyricsPane } from './components/LyricsPane';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { Timeline } from './components/Timeline/Timeline';
import { Toaster } from './components/Toast';
import { TopBar } from './components/TopBar';
import { useEditorShortcuts } from './hooks/useEditorShortcuts';
import { playback } from './state/playback';
import { initSession, saveCurrent, useSession } from './state/session';
import { useStore } from './state/store';
import { view } from './state/view';
import styles from './App.module.css';

const onSave = () => void saveCurrent();

export default function App() {
  const audioUrl = useStore((s) => s.project?.audioUrl ?? null);
  const hasProject = useStore((s) => s.project !== null);
  const loading = useSession((s) => s.loading);
  const loadError = useSession((s) => s.loadError);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    void initSession();
  }, []);

  // One <audio> element for the whole app; playback.ts is the only thing that touches it.
  // Keyed on the URL below, so switching tracks gets a fresh element and a clean attach.
  useEffect(() => playback.attach(audioRef.current), [audioUrl]);

  useEditorShortcuts({ onSave });
  useWindowAudioDrop();

  return (
    <div className={styles.app}>
      {audioUrl && <audio key={audioUrl} ref={audioRef} src={audioUrl} preload="auto" hidden />}
      {hasProject ? (
        <>
          <TopBar />
          <main className={styles.main}>
            <aside className={styles.lyrics}>
              <LyricsPane />
            </aside>
            <section className={styles.center}>
              <div className={styles.timeline}>
                <Timeline />
              </div>
              <div className={styles.karaoke}>
                <Karaoke />
              </div>
            </section>
            <aside className={styles.inspector}>
              <Inspector />
            </aside>
          </main>
        </>
      ) : (
        <div className={styles.empty}>
          {loading ? (
            <p role="status">Loading…</p>
          ) : (
            <>
              <p>{loadError ?? 'No track open.'}</p>
              <button type="button" onClick={() => view.openModal('load')}>
                Load a song
              </button>
            </>
          )}
        </div>
      )}
      <LoadTrackDialog />
      <ConflictDialog />
      <ShortcutsHelp />
      <Toaster />
    </div>
  );
}

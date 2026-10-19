/**
 * Project lifecycle + save state. External store (same pattern as view.ts).
 *
 * - Projects: the seeded server track + local ("bring your own") tracks.
 * - Autosave: every doc/meta change is written to localStorage after 500 ms. Local projects
 *   write to their real storage; the server track writes a *draft* (with the server version
 *   and doc it was based on) that is restored on the next open. Nothing is sent to the
 *   server until saveCurrent() (Cmd/Ctrl+S).
 * - saveCurrent: server project -> validate, PUT, handle ok / 409 / 400 / network error.
 */
import type { Doc, Project } from '../domain/types';
import { newLineId } from '../domain/ids';
import { parseLyricSheet, validateForServer } from '../domain/ops';
import { secToMs } from '../domain/time';
import {
  clearServerDraft,
  createLocal,
  deleteLocal,
  getLastKey,
  listLocal,
  loadLocal,
  readServerDraft,
  revokeAudioUrl,
  saveLocalDoc,
  setLastKey,
  writeServerDraft,
} from '../persistence/local';
import { fetchServerProject, saveServerProject } from '../persistence/serverAdapter';
import { toast } from '../components/Toast/toastStore';
import { useExternalSelector } from './external';
import { docKey, store } from './store';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export interface ProjectSummary {
  key: string;
  title: string;
  artist: string;
  source: 'server' | 'local';
}

export interface ConflictInfo {
  baseVersion: number;
  server: { version: number; doc: Doc };
}

export interface SessionState {
  projects: ProjectSummary[];
  status: SaveStatus;
  lastSavedAt: number | null;
  conflict: ConflictInfo | null;
  loading: boolean;
  /** Set when the initial project could not be opened at all (e.g. server down and no draft). */
  loadError: string | null;
}

const AUTOSAVE_MS = 500;

let state: SessionState = {
  projects: [{ key: 'server', title: 'Server track', artist: '', source: 'server' }],
  status: 'idle',
  lastSavedAt: null,
  conflict: null,
  loading: false,
  loadError: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<SessionState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const session = {
  getState: (): SessionState => state,
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export function useSession<T>(selector: (s: SessionState) => T, isEqual?: (a: T, b: T) => boolean): T {
  return useExternalSelector(session.subscribe, session.getState, selector, isEqual);
}

export function listProjects(): ProjectSummary[] {
  return state.projects;
}

let serverTitle = { title: 'Server track', artist: '' };
/** The doc the server last confirmed (base of the draft). */
let serverBaseDoc: Doc | null = null;

function refreshProjects() {
  const locals = listLocal().map<ProjectSummary>((p) => ({ key: p.key, title: p.title, artist: p.artist, source: 'local' }));
  set({ projects: [{ key: 'server', ...serverTitle, source: 'server' }, ...locals] });
}

// ---------------------------------------------------------------- autosave

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSeen: { key: string; doc: Doc; title: string; artist: string } | null = null;
let writeWarned = false;

function persistNow() {
  if (timer) clearTimeout(timer);
  timer = null;
  const { project, dirty } = store.getState();
  if (!project) return;
  try {
    if (project.source === 'server') {
      if (dirty && project.serverVersion !== undefined && serverBaseDoc) {
        writeServerDraft({
          baseVersion: project.serverVersion,
          baseDoc: serverBaseDoc,
          doc: project.doc,
          title: project.title,
          artist: project.artist,
          audioUrl: project.audioUrl,
          durationMs: project.durationMs,
          savedAt: Date.now(),
        });
      } else if (!dirty) {
        clearServerDraft();
      }
    } else {
      saveLocalDoc(project);
      store.markSaved(project.doc);
      if (state.projects.some((p) => p.key === project.key && (p.title !== project.title || p.artist !== project.artist))) refreshProjects();
      set({ status: 'saved', lastSavedAt: Date.now() });
    }
    writeWarned = false;
  } catch (e) {
    if (!writeWarned) toast.error(e instanceof Error ? e.message : 'Could not save locally.');
    writeWarned = true;
    if (project.source === 'local') set({ status: 'error' });
  }
}

function onStoreChange() {
  const { project } = store.getState();
  if (!project) return;
  const seen = lastSeen;
  lastSeen = { key: project.key, doc: project.doc, title: project.title, artist: project.artist };
  if (!seen || seen.key !== project.key) return; // just switched/loaded: nothing to persist
  if (seen.doc === project.doc && seen.title === project.title && seen.artist === project.artist) return;
  if (state.status === 'saved' || state.status === 'error') set({ status: 'idle' });
  if (timer) clearTimeout(timer);
  timer = setTimeout(persistNow, AUTOSAVE_MS);
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  store.subscribe(onStoreChange);
  window.addEventListener('beforeunload', persistNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistNow();
  });
}

/** Write any pending autosave right now (used before switching projects). */
export function flushAutosave(): void {
  if (timer) persistNow();
}

// ---------------------------------------------------------------- opening

function install(project: Project, savedDoc?: Doc) {
  if (timer) persistNow();
  set({ conflict: null, status: 'idle' });
  store.loadProject(project);
  if (savedDoc) store.markSaved(savedDoc, project.serverVersion);
  lastSeen = { key: project.key, doc: store.getState().project!.doc, title: project.title, artist: project.artist };
  setLastKey(project.key);
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Open the seeded server track. If an unsaved draft exists it is restored on top of what the
 * server returned (the project opens dirty, with a toast). If the server has moved on since the
 * draft was made, the draft is still restored with its OLD base version, so the next save hits
 * the normal 409 flow and the user can compare instead of silently losing either side.
 * If the server is unreachable but a draft exists, the draft opens read from its own metadata.
 */
export async function openServerProject(): Promise<boolean> {
  wire();
  flushAutosave();
  set({ loading: true, loadError: null });
  const draft = readServerDraft();
  let server: Project | null = null;
  let netError = '';
  try {
    server = await fetchServerProject();
  } catch (e) {
    netError = msg(e);
  }
  try {
    revokeAudioUrl();
    if (server) {
      serverTitle = { title: server.title, artist: server.artist };
      refreshProjects();
      if (draft && draft.baseVersion === server.serverVersion && docKey(draft.doc) !== docKey(server.doc)) {
        serverBaseDoc = server.doc;
        install({ ...server, doc: draft.doc }, server.doc);
        toast.info('Restored your unsaved changes from last time.');
      } else if (draft && draft.baseVersion !== server.serverVersion && docKey(draft.doc) !== docKey(draft.baseDoc)) {
        serverBaseDoc = draft.baseDoc;
        install({ ...server, doc: draft.doc, serverVersion: draft.baseVersion }, draft.baseDoc);
        toast.warning(
          `Restored unsaved changes made against version ${draft.baseVersion}, but the server is now at version ${server.serverVersion}. Saving will let you compare.`,
        );
      } else {
        serverBaseDoc = server.doc;
        clearServerDraft();
        install(server);
      }
      return true;
    }
    if (draft) {
      serverBaseDoc = draft.baseDoc;
      serverTitle = { title: draft.title, artist: draft.artist };
      refreshProjects();
      install(
        {
          key: 'server',
          source: 'server',
          title: draft.title,
          artist: draft.artist,
          audioUrl: draft.audioUrl,
          durationMs: draft.durationMs,
          doc: draft.doc,
          serverVersion: draft.baseVersion,
        },
        draft.baseDoc,
      );
      toast.warning("Couldn't reach the server. Opened your unsaved local draft; save once you're back online.");
      return true;
    }
    set({ loadError: `Couldn't load the track from the server. ${netError}` });
    return false;
  } finally {
    set({ loading: false });
  }
}

export async function openLocalProject(key: string): Promise<boolean> {
  wire();
  flushAutosave();
  try {
    const p = await loadLocal(key);
    install(p);
    refreshProjects();
    return true;
  } catch (e) {
    toast.error(msg(e));
    return false;
  }
}

export async function openProject(key: string): Promise<boolean> {
  return key === 'server' ? openServerProject() : openLocalProject(key);
}

let initPromise: Promise<void> | null = null;
/** Reopen the last project (falls back to the server track). Safe to call twice (StrictMode). */
export function initSession(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    wire();
    refreshProjects();
    const last = getLastKey();
    if (last && last !== 'server' && state.projects.some((p) => p.key === last)) {
      set({ loading: true });
      const ok = await openLocalProject(last);
      set({ loading: false });
      if (ok) {
        // The server track isn't opened, but the Load song list should still show its real title.
        fetchServerProject()
          .then((server) => {
            serverTitle = { title: server.title, artist: server.artist };
            refreshProjects();
          })
          .catch(() => {});
        return;
      }
    }
    await openServerProject();
  })();
  return initPromise;
}

// ---------------------------------------------------------------- creating / deleting

/** Read the duration from the audio itself; rejects with a readable message if undecodable. */
export function probeDuration(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = 'metadata';
    const done = (fn: () => void) => {
      clearTimeout(t);
      a.removeAttribute('src');
      a.load();
      fn();
    };
    const t = setTimeout(() => done(() => reject(new Error("Timed out reading the audio. Check that it's a valid audio file or URL."))), 15000);
    a.onloadedmetadata = () => {
      const d = a.duration;
      done(() =>
        Number.isFinite(d) && d > 0
          ? resolve(secToMs(d))
          : reject(new Error('Could not determine the length of this audio (live streams are not supported).')),
      );
    };
    a.onerror = () => done(() => reject(new Error("This audio couldn't be decoded. Try an mp3, wav, m4a or ogg file, or check the URL.")));
    a.src = src;
  });
}

export interface NewTrackInput {
  title: string;
  artist: string;
  audio: File | string;
  lyricsText: string;
}

export async function createLocalProject(input: NewTrackInput): Promise<Project> {
  const lines = parseLyricSheet(input.lyricsText);
  if (!lines.length) throw new Error('Add at least one lyric line.');
  const isFile = typeof input.audio !== 'string';
  const url = isFile ? URL.createObjectURL(input.audio as File) : (input.audio as string).trim();
  let durationMs: number;
  try {
    durationMs = await probeDuration(url);
  } finally {
    if (isFile) URL.revokeObjectURL(url);
  }
  const key = `local:${crypto.randomUUID()}`;
  const doc: Doc = { lines: lines.map((text) => ({ id: newLineId(), text })), segments: {} };
  const title = input.title.trim() || (isFile ? (input.audio as File).name.replace(/\.[^.]+$/, '') : 'Untitled');
  await createLocal(
    {
      key,
      title,
      artist: input.artist.trim(),
      durationMs,
      doc,
      audio: isFile
        ? { kind: 'blob', name: (input.audio as File).name, type: (input.audio as File).type }
        : { kind: 'url', url },
    },
    isFile ? (input.audio as File) : null,
  );
  refreshProjects();
  const ok = await openLocalProject(key);
  if (!ok) throw new Error('The track was saved but could not be opened.');
  return store.getState().project!;
}

export async function deleteLocalProject(key: string): Promise<void> {
  if (key === 'server') return;
  const wasOpen = store.getState().project?.key === key;
  if (wasOpen && timer) {
    clearTimeout(timer);
    timer = null;
  }
  await deleteLocal(key);
  refreshProjects();
  if (wasOpen) await openServerProject();
}

// ---------------------------------------------------------------- saving

/** Save the open project. Local: flush to browser storage. Server: validate, PUT, handle 409/400/network. */
export async function saveCurrent(): Promise<void> {
  const project = store.getState().project;
  if (!project || state.status === 'saving') return;

  if (project.source === 'local') {
    persistNow();
    return;
  }

  const issues = validateForServer(project.doc);
  if (issues.length) {
    toast.error(`Can't save yet:\n${issues.slice(0, 5).map((i) => `• ${i.message}`).join('\n')}`);
    set({ status: 'error' });
    return;
  }

  set({ status: 'saving' });
  const sent = project.doc;
  const res = await saveServerProject(project);
  if (store.getState().project?.key !== project.key) return; // switched away mid-flight
  switch (res.kind) {
    case 'ok':
      serverBaseDoc = sent;
      store.markSaved(sent, res.version);
      persistNow(); // clears the draft if nothing changed meanwhile
      set({ status: 'saved', lastSavedAt: Date.now(), conflict: null });
      break;
    case 'conflict':
      set({ status: 'conflict', conflict: { server: res.server, baseVersion: project.serverVersion ?? 0 } });
      break;
    case 'invalid':
      toast.error(`The server rejected the save: ${res.hint}`);
      set({ status: 'error' });
      break;
    case 'error':
      toast.error("Couldn't reach the server — your changes are kept locally.");
      persistNow();
      set({ status: 'error' });
      break;
  }
}

// ---------------------------------------------------------------- conflict resolution

/** Resave my doc on top of the server's current version. */
export async function resolveKeepMine(): Promise<void> {
  const c = state.conflict;
  if (!c) return;
  serverBaseDoc = c.server.doc;
  store.markSaved(c.server.doc, c.server.version);
  set({ conflict: null, status: 'idle' });
  await saveCurrent();
}

/** Replace my doc with the server's. Undoable. */
export function resolveUseServer(): void {
  const c = state.conflict;
  const project = store.getState().project;
  if (!c || !project) return;
  serverBaseDoc = c.server.doc;
  store.replaceProject(
    { ...project, doc: c.server.doc, serverVersion: c.server.version },
    { history: 'push', savedDoc: c.server.doc },
  );
  lastSeen = { key: project.key, doc: store.getState().project!.doc, title: project.title, artist: project.artist };
  persistNow();
  set({ conflict: null, status: 'saved', lastSavedAt: Date.now() });
}

/** Leave the conflict for later; the project stays dirty. */
export function cancelConflict(): void {
  set({ conflict: null, status: 'idle' });
}

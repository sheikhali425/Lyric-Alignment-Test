/**
 * Browser persistence. Project meta + doc live in localStorage (JSON, prefix 'lyric-align:'),
 * audio Blobs live in IndexedDB (idb.ts). A Project built from storage gets a fresh object URL
 * for its blob; the previous one is revoked when another project is opened.
 */
import type { Doc, Project } from '../domain/types';
import { deleteBlob, getBlob, putBlob } from './idb';

const P = 'lyric-align:';
const INDEX_KEY = `${P}index`;
const LAST_KEY = `${P}last`;
const projectKey = (key: string) => `${P}project:${key}`;
const DRAFT_KEY = `${P}draft:server`;

export type StoredAudio = { kind: 'blob'; name: string; type: string } | { kind: 'url'; url: string };

export interface StoredLocal {
  key: string;
  title: string;
  artist: string;
  durationMs: number;
  doc: Doc;
  audio: StoredAudio;
  updatedAt: number;
}

export interface ServerDraft {
  baseVersion: number;
  /** The doc the server had at baseVersion (what "saved" meant when the draft was made). */
  baseDoc: Doc;
  doc: Doc;
  title: string;
  artist: string;
  audioUrl: string;
  durationMs: number;
  savedAt: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
    throw new Error(
      quota
        ? 'Browser storage is full, so your changes could not be saved locally. Free some space or export your LRC.'
        : 'Browser storage is unavailable, so your changes could not be saved locally.',
    );
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ----- index / last opened -----

function readIndex(): string[] {
  const v = read<string[]>(INDEX_KEY);
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

export function listLocal(): StoredLocal[] {
  return readIndex()
    .map((k) => read<StoredLocal>(projectKey(k)))
    .filter((p): p is StoredLocal => !!p && !!p.doc);
}

export function getLastKey(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function setLastKey(key: string): void {
  try {
    localStorage.setItem(LAST_KEY, key);
  } catch {
    /* non-critical */
  }
}

// ----- local projects -----

export function writeLocal(stored: StoredLocal): void {
  write(projectKey(stored.key), stored);
  const idx = readIndex();
  if (!idx.includes(stored.key)) write(INDEX_KEY, [...idx, stored.key]);
}

/** Persist a new local project: audio blob first (so a failure leaves nothing behind), then meta. */
export async function createLocal(input: Omit<StoredLocal, 'updatedAt'>, blob: Blob | null): Promise<void> {
  if (input.audio.kind === 'blob') {
    if (!blob) throw new Error('Missing audio data.');
    await putBlob(input.key, blob);
  }
  try {
    writeLocal({ ...input, updatedAt: Date.now() });
  } catch (e) {
    if (input.audio.kind === 'blob') await deleteBlob(input.key).catch(() => undefined);
    throw e;
  }
}

/** Save the doc/meta of an open local project (audio untouched). */
export function saveLocalDoc(project: Project): void {
  const prev = read<StoredLocal>(projectKey(project.key));
  if (!prev) throw new Error('This local project no longer exists in browser storage.');
  writeLocal({ ...prev, title: project.title, artist: project.artist, doc: project.doc, updatedAt: Date.now() });
}

let currentObjectUrl: string | null = null;

export function revokeAudioUrl(): void {
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = null;
}

export async function loadLocal(key: string): Promise<Project> {
  const s = read<StoredLocal>(projectKey(key));
  if (!s) throw new Error('That project was not found in browser storage.');
  let audioUrl: string;
  if (s.audio.kind === 'url') {
    audioUrl = s.audio.url;
    revokeAudioUrl();
  } else {
    const blob = await getBlob(key);
    if (!blob) throw new Error('The audio file for this project is missing from browser storage. Delete it and load the track again.');
    revokeAudioUrl();
    currentObjectUrl = URL.createObjectURL(blob);
    audioUrl = currentObjectUrl;
  }
  return {
    key: s.key,
    source: 'local',
    title: s.title,
    artist: s.artist,
    audioUrl,
    durationMs: s.durationMs,
    doc: s.doc,
  };
}

export async function deleteLocal(key: string): Promise<void> {
  remove(projectKey(key));
  write(INDEX_KEY, readIndex().filter((k) => k !== key));
  if (getLastKey() === key) remove(LAST_KEY);
  await deleteBlob(key).catch(() => undefined);
}

// ----- server draft (unsaved work on the server track) -----

export function readServerDraft(): ServerDraft | null {
  const d = read<ServerDraft>(DRAFT_KEY);
  return d && d.doc && d.baseDoc && typeof d.baseVersion === 'number' ? d : null;
}

export function writeServerDraft(d: ServerDraft): void {
  write(DRAFT_KEY, d);
}

export function clearServerDraft(): void {
  remove(DRAFT_KEY);
}

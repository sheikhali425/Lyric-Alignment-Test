/** Server track <-> Project. Seconds -> ms conversion for duration_seconds happens here via time.ts. */
import { api, ApiError } from '../api';
import { secToMs } from '../domain/time';
import type { Doc, Project, Segment } from '../domain/types';

interface ServerLine {
  id: string;
  index: number;
  text: string;
}
interface ServerAlignment {
  segments: { line_id: string; start_ms: number; end_ms: number }[];
}
interface TrackDto {
  id: string;
  title: string;
  artist: string;
  duration_seconds: number;
  audio_url: string;
  lines: ServerLine[];
  version: number;
  alignment: ServerAlignment | null;
}

export type SaveResult =
  | { kind: 'ok'; project: Project; doc: Doc; version: number }
  | { kind: 'conflict'; server: { version: number; doc: Doc } }
  | { kind: 'invalid'; hint: string; code: string }
  | { kind: 'error'; message: string };

export function serverStateToDoc(lines: ServerLine[], alignment: ServerAlignment | null | undefined): Doc {
  const sorted = [...lines].sort((a, b) => a.index - b.index);
  const ids = new Set(sorted.map((l) => l.id));
  const segments: Record<string, Segment> = {};
  for (const s of alignment?.segments ?? []) {
    if (ids.has(s.line_id)) segments[s.line_id] = { startMs: s.start_ms, endMs: s.end_ms };
  }
  return { lines: sorted.map((l) => ({ id: l.id, text: l.text })), segments };
}

export async function fetchServerProject(): Promise<Project> {
  const t = await api<TrackDto>('/api/v1/track');
  return {
    key: 'server',
    source: 'server',
    title: t.title,
    artist: t.artist,
    audioUrl: t.audio_url,
    durationMs: secToMs(t.duration_seconds),
    doc: serverStateToDoc(t.lines, t.alignment),
    serverVersion: t.version,
  };
}

export function toPayload(project: Project) {
  const { doc } = project;
  const lines = doc.lines.map((l, index) => ({ id: l.id, index, text: l.text }));
  const segments = doc.lines
    .filter((l) => doc.segments[l.id])
    .map((l) => ({
      line_id: l.id,
      start_ms: Math.round(doc.segments[l.id].startMs),
      end_ms: Math.round(doc.segments[l.id].endMs),
    }));
  return { version: project.serverVersion ?? 0, lines, segments };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export async function saveServerProject(project: Project): Promise<SaveResult> {
  try {
    const res = await api<{ version: number; lines: ServerLine[]; alignment: ServerAlignment | null }>(
      '/api/v1/track/alignment',
      { method: 'PUT', body: JSON.stringify(toPayload(project)) },
    );
    const doc = serverStateToDoc(res.lines, res.alignment);
    return { kind: 'ok', doc, version: res.version, project: { ...project, doc, serverVersion: res.version } };
  } catch (e) {
    if (e instanceof ApiError) {
      const b = isObj(e.body) ? e.body : {};
      if (e.status === 409 && Array.isArray(b.lines) && typeof b.version === 'number') {
        return {
          kind: 'conflict',
          server: { version: b.version, doc: serverStateToDoc(b.lines as ServerLine[], b.alignment as ServerAlignment | null) },
        };
      }
      if (e.status === 400) {
        return {
          kind: 'invalid',
          code: typeof b.error === 'string' ? b.error : 'bad_request',
          hint: typeof b.hint === 'string' ? b.hint : e.message,
        };
      }
      return { kind: 'error', message: e.message };
    }
    if (e instanceof TypeError) return { kind: 'error', message: 'Network error: could not reach the server.' };
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

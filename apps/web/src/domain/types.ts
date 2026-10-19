/** Core data model. All times are integer milliseconds. Everything is keyed by line id, never by text. */

export interface Line {
  id: string;
  text: string;
}

export interface Segment {
  startMs: number;
  endMs: number;
}

export interface Doc {
  /** Order of this array is the lyric order. */
  lines: Line[];
  /** Keyed by line id. A line without an entry is untimed. */
  segments: Record<string, Segment>;
}

export interface Project {
  /** 'server' for the seeded track, 'local:<uuid>' for a track the user brought. */
  key: string;
  source: 'server' | 'local';
  title: string;
  artist: string;
  audioUrl: string;
  durationMs: number;
  doc: Doc;
  serverVersion?: number;
}

import type { Project } from './types';
import { orderedTimedIds } from './ops';

function stampLrc(ms: number): string {
  const cs = Math.round(Math.max(0, ms) / 10);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}]`;
}

/** LRC text: [ti:]/[ar:] headers, then one `[mm:ss.xx]text` per timed line in time order. Untimed lines are omitted. */
export function toLrc(project: Project): string {
  const { doc } = project;
  const byId = new Map(doc.lines.map((l) => [l.id, l]));
  const out: string[] = [];
  if (project.title) out.push(`[ti:${project.title}]`);
  if (project.artist) out.push(`[ar:${project.artist}]`);
  for (const id of orderedTimedIds(doc)) {
    out.push(`${stampLrc(doc.segments[id].startMs)}${byId.get(id)!.text}`);
  }
  return out.join('\n') + '\n';
}

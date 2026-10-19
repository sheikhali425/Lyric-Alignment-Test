import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, PointerEvent } from 'react';
import { peaksForRange } from '../../audio/peaks';
import * as ops from '../../domain/ops';
import type { Doc } from '../../domain/types';
import { formatMs, formatShort } from '../../domain/time';
import { usePeaks } from '../../hooks/usePeaks';
import { playback } from '../../state/playback';
import { store, useStore } from '../../state/store';
import { useView, view } from '../../state/view';
import {
  DRAG_THRESHOLD_PX,
  EDGE_PX,
  RULER_H,
  ROW_H,
  SNAP_PX,
  WAVE_H,
  laneHeight,
  layoutRows,
  msToPx,
  pxToMs,
  rowTop,
  tickStepSec,
} from './geometry';
import styles from './Timeline.module.css';

const LINE_MIME = 'application/x-lyric-line';
const MANUAL_SCROLL_HOLD_MS = 2000;

interface DragSession {
  mode: 'move' | 'start' | 'end';
  id: string;
  pointerId: number;
  startX: number;
  ids: string[];
  startDoc: Doc;
  targets: number[];
  moved: boolean;
  el: HTMLElement;
  onKey: (e: globalThis.KeyboardEvent) => void;
}

interface DragView {
  ghosts: { id: string; startMs: number; endMs: number; row: number }[];
  guideMs: number | null;
  tip: { x: number; text: string };
}

interface MarqueeSession {
  pointerId: number;
  x0: number;
  y0: number;
  base: string[];
  moved: boolean;
}

export function Timeline() {
  const doc = useStore((s) => s.project?.doc);
  const durationProp = useStore((s) => s.project?.durationMs ?? 0);
  const audioUrl = useStore((s) => s.project?.audioUrl);
  const selection = useStore((s) => s.selection);
  const cursorId = useStore((s) => s.cursorId);
  const pps = useView((s) => s.pxPerSec);
  const { peaks, status: peaksStatus } = usePeaks(audioUrl);

  const durationMs = useMemo(() => {
    let d = Math.max(durationProp, peaks?.durationMs ?? 0, 1000);
    if (doc) for (const s of Object.values(doc.segments)) d = Math.max(d, s.endMs);
    return d;
  }, [durationProp, peaks, doc]);
  const contentW = Math.ceil(msToPx(durationMs, pps));

  const { items, rows } = useMemo(
    () => (doc ? layoutRows(doc.lines, doc.segments) : { items: [], rows: 1 }),
    [doc],
  );
  const selSet = useMemo(() => new Set(selection), [selection]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const rulerCv = useRef<HTMLCanvasElement>(null);
  const waveCv = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);

  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const durRef = useRef(durationMs);
  durRef.current = durationMs;
  const peaksRef = useRef(peaks);
  peaksRef.current = peaks;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const prevPps = useRef(pps);
  const zoomAnchor = useRef<{ ms: number; off: number } | null>(null);
  const lastUserScroll = useRef(0);
  const expectedLeft = useRef<number | null>(null);
  const rafDraw = useRef(0);

  const [drag, setDrag] = useState<DragView | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dropMs, setDropMs] = useState<number | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const marqueeRef = useRef<MarqueeSession | null>(null);

  // Opening a track starts zoomed to fit the whole song, whatever its length; the fit scale is
  // also the zoom-out limit, so it is kept current as the timeline is resized.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !audioUrl || durationProp <= 0) return;
    const fit = () => sc.clientWidth / (durationProp / 1000);
    view.setFit(fit(), true);
    const ro = new ResizeObserver(() => view.setFit(fit()));
    ro.observe(sc);
    return () => ro.disconnect();
  }, [audioUrl, durationProp]);

  // ---------- canvas drawing (visible window only) ----------
  const draw = useCallback(() => {
    const sc = scrollRef.current;
    const rc = rulerCv.current;
    const wc = waveCv.current;
    if (!sc || !rc || !wc) return;
    const p = ppsRef.current;
    const cssW = Math.max(1, sc.clientWidth);
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.round(cssW * dpr);
    const cs = getComputedStyle(sc);
    const color = (name: string) => cs.getPropertyValue(name).trim() || '#888';
    const border = color('--border');
    const muted = color('--text-muted');
    const accent = color('--accent');
    const text = color('--text');
    const left = sc.scrollLeft;
    const startMs = pxToMs(left, p);
    const endMs = pxToMs(left + cssW, p);

    for (const [cv, h] of [[rc, RULER_H], [wc, WAVE_H]] as const) {
      if (cv.width !== pxW || cv.height !== Math.round(h * dpr)) {
        cv.width = pxW;
        cv.height = Math.round(h * dpr);
      }
      cv.style.width = `${cssW}px`;
      cv.style.height = `${h}px`;
    }

    // ruler
    {
      const g = rc.getContext('2d');
      if (g) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, cssW, RULER_H);
        g.font = `11px ${color('--font-mono')}`;
        g.textBaseline = 'top';
        const step = tickStepSec(p);
        const minorStep = step / 5;
        g.fillStyle = muted;
        g.strokeStyle = border;
        g.lineWidth = 1;
        g.beginPath();
        const firstMinor = Math.floor(startMs / 1000 / minorStep);
        const lastMinor = Math.ceil(endMs / 1000 / minorStep);
        for (let k = firstMinor; k <= lastMinor; k++) {
          const t = k * minorStep;
          if (t < 0 || t * 1000 > durRef.current) continue;
          const x = Math.round(msToPx(t * 1000, p) - left) + 0.5;
          const major = k % 5 === 0;
          g.moveTo(x, major ? 6 : RULER_H - 6);
          g.lineTo(x, RULER_H);
          if (major) {
            const label = step >= 1 ? formatShort(t * 1000) : formatMs(t * 1000).slice(0, -2);
            g.fillText(label, x + 3, 3);
          }
        }
        g.stroke();
      }
    }

    // waveform
    {
      const g = wc.getContext('2d');
      if (g) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, wc.width, wc.height);
        const mid = wc.height / 2;
        const pk = peaksRef.current;
        g.fillStyle = accent;
        g.globalAlpha = 0.75;
        if (pk) {
          const cols = pxW;
          const { min, max } = peaksForRange(pk, startMs, endMs, cols);
          const scale = pk.absMax > 0 ? (mid - 2 * dpr) / pk.absMax : 0;
          for (let x = 0; x < cols; x++) {
            const y0 = mid - max[x] * scale;
            const y1 = mid - min[x] * scale;
            g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
          }
        } else {
          g.fillStyle = muted;
          g.fillRect(0, mid - 0.5 * dpr, pxW, Math.max(1, dpr));
        }
        g.globalAlpha = 1;
        // end-of-audio marker is implicit: columns beyond the data are flat. Midline for reference:
        g.fillStyle = text;
        g.globalAlpha = 0.08;
        g.fillRect(0, mid, pxW, Math.max(1, dpr));
        g.globalAlpha = 1;
      }
    }
  }, []);

  const scheduleDraw = useCallback(() => {
    if (rafDraw.current) return;
    rafDraw.current = requestAnimationFrame(() => {
      rafDraw.current = 0;
      draw();
    });
  }, [draw]);

  const positionPlayhead = useCallback((ms: number) => {
    const el = playheadRef.current;
    if (el) el.style.transform = `translateX(${msToPx(ms, ppsRef.current)}px)`;
  }, []);

  // zoom: keep the anchor time fixed under the mouse (wheel); for buttons/keys, under the playhead
  // when it is on screen (zooming from fit-to-width would otherwise fling it out of view), else
  // the viewport centre
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (sc && prevPps.current !== pps) {
      const headMs = playback.getMs();
      const headOff = msToPx(headMs, prevPps.current) - sc.scrollLeft;
      const anchor =
        zoomAnchor.current ??
        (headOff >= 0 && headOff <= sc.clientWidth
          ? { ms: headMs, off: headOff }
          : { ms: pxToMs(sc.scrollLeft + sc.clientWidth / 2, prevPps.current), off: sc.clientWidth / 2 });
      sc.scrollLeft = Math.max(0, msToPx(anchor.ms, pps) - anchor.off);
      zoomAnchor.current = null;
    }
    prevPps.current = pps;
    positionPlayhead(playback.getMs());
    draw();
  }, [pps, contentW, positionPlayhead, draw]);

  useEffect(() => {
    scheduleDraw();
  }, [peaks, peaksStatus, scheduleDraw]);

  // resize, theme, scroll
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const ro = new ResizeObserver(scheduleDraw);
    ro.observe(sc);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', scheduleDraw);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', scheduleDraw);
      cancelAnimationFrame(rafDraw.current);
      rafDraw.current = 0;
    };
  }, [scheduleDraw]);

  // wheel zoom (non-passive so we can preventDefault the browser's page zoom)
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const onWheel = (e: WheelEvent) => {
      lastUserScroll.current = performance.now();
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const off = e.clientX - sc.getBoundingClientRect().left;
      if (zoomAnchor.current) zoomAnchor.current.off = off;
      else {
        zoomAnchor.current = { ms: pxToMs(sc.scrollLeft + off, ppsRef.current), off };
        requestAnimationFrame(() => {
          zoomAnchor.current = null;
        });
      }
      view.zoomBy(Math.exp(-e.deltaY * 0.01));
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => sc.removeEventListener('wheel', onWheel);
  }, []);

  // playhead: imperative, no React per frame
  useEffect(() => {
    positionPlayhead(playback.getMs());
    return playback.subscribeFrame((ms) => {
      positionPlayhead(ms);
      const sc = scrollRef.current;
      if (!sc || !playback.isPlaying()) return;
      if (performance.now() - lastUserScroll.current < MANUAL_SCROLL_HOLD_MS) return;
      const x = msToPx(ms, ppsRef.current);
      const w = sc.clientWidth;
      if (x > sc.scrollLeft + w - 24 || x < sc.scrollLeft) {
        const target = Math.max(0, Math.round(x - w * 0.1));
        expectedLeft.current = target;
        sc.scrollLeft = target;
      }
    });
  }, [positionPlayhead]);

  const onScroll = () => {
    const sc = scrollRef.current;
    if (sc && sc.scrollLeft !== expectedLeft.current) lastUserScroll.current = performance.now();
    scheduleDraw();
  };

  const xToMs = (clientX: number): number => {
    const r = contentRef.current!.getBoundingClientRect();
    return Math.min(Math.max(pxToMs(clientX - r.left, ppsRef.current), 0), durRef.current);
  };

  // ---------- seek / scrub on ruler + waveform ----------
  const onScrubDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    playback.seek(Math.round(xToMs(e.clientX)));
  };
  const onScrubMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) playback.seek(Math.round(xToMs(e.clientX)));
  };

  // ---------- block drag / trim / click ----------
  const endDrag = (cancel: boolean) => {
    const s = dragRef.current;
    if (!s) return;
    dragRef.current = null;
    window.removeEventListener('keydown', s.onKey, true);
    if (s.moved) {
      if (cancel) store.cancelTransaction();
      else store.commitTransaction();
    }
    try {
      s.el.releasePointerCapture(s.pointerId);
    } catch {
      /* already released */
    }
    setDrag(null);
  };

  useEffect(() => () => endDrag(true), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onBlockDown = (e: PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || dragRef.current || !doc) return;
    const edgeAttr = (e.target as HTMLElement).dataset.edge;
    const mode: DragSession['mode'] = edgeAttr === 'start' || edgeAttr === 'end' ? edgeAttr : 'move';
    const sel = store.getState().selection;
    const ids = mode === 'move' ? (sel.includes(id) ? sel.filter((x) => doc.segments[x]) : [id]) : [id];
    const moving = new Set(ids);
    const targets: number[] = [];
    for (const [lid, s] of Object.entries(doc.segments)) {
      if (!moving.has(lid)) targets.push(s.startMs, s.endMs);
    }
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      endDrag(true);
    };
    window.addEventListener('keydown', onKey, true);
    dragRef.current = { mode, id, pointerId: e.pointerId, startX: e.clientX, ids, startDoc: doc, targets, moved: false, el, onKey };
    e.stopPropagation();
  };

  const onBlockMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = dragRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startX;
    if (!s.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      s.moved = true;
      store.beginTransaction();
      if (s.mode === 'move' && !store.getState().selection.includes(s.id)) store.select([s.id], s.id);
    }
    const p = ppsRef.current;
    const dur = durRef.current;
    let delta = pxToMs(dx, p);
    let guideMs: number | null = null;
    if (!e.altKey) {
      const tol = pxToMs(SNAP_PX, p);
      const moving: number[] = [];
      for (const id of s.mode === 'move' ? s.ids : [s.id]) {
        const seg = s.startDoc.segments[id];
        if (!seg) continue;
        if (s.mode === 'move') moving.push(seg.startMs, seg.endMs);
        else moving.push(s.mode === 'start' ? seg.startMs : seg.endMs);
      }
      const targets = [...s.targets, playback.getMs()];
      let best = tol;
      let bestDiff = 0;
      for (const m of moving) {
        for (const t of targets) {
          const diff = t - (m + delta);
          if (Math.abs(diff) < best) {
            best = Math.abs(diff);
            bestDiff = diff;
            guideMs = t;
          }
        }
      }
      if (guideMs !== null) delta += bestDiff;
    }
    delta = Math.round(delta);
    store.applyLive(() =>
      s.mode === 'move'
        ? ops.shift(s.startDoc, s.ids, delta, dur)
        : ops.trimEdge(s.startDoc, [s.id], s.mode, delta, dur),
    );
    const now = store.getState().project?.doc.segments[s.id];
    const rect = contentRef.current!.getBoundingClientRect();
    const tipText = !now
      ? ''
      : s.mode === 'start'
        ? formatMs(now.startMs)
        : s.mode === 'end'
          ? formatMs(now.endMs)
          : `${formatMs(now.startMs)} – ${formatMs(now.endMs)}`;
    const rowOf = new Map(itemsRef.current.map((it) => [it.id, it.row]));
    setDrag({
      ghosts: (s.mode === 'move' ? s.ids : [s.id]).flatMap((id) => {
        const seg = s.startDoc.segments[id];
        return seg ? [{ id, startMs: seg.startMs, endMs: seg.endMs, row: rowOf.get(id) ?? 0 }] : [];
      }),
      guideMs,
      tip: { x: e.clientX - rect.left, text: tipText },
    });
  };

  const onBlockUp = (e: PointerEvent<HTMLDivElement>, id: string) => {
    const s = dragRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const wasMoved = s.moved;
    endDrag(false);
    if (wasMoved) return;
    selectAndPlay(id, e);
  };

  const selectAndPlay = (id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (e.shiftKey) store.selectRange(id);
    else if (e.metaKey || e.ctrlKey) store.toggle(id);
    else store.select([id], id);
    if (!store.getState().selection.includes(id)) return;
    const seg = store.getState().project?.doc.segments[id];
    if (seg) playback.playRange(seg.startMs, seg.endMs);
  };

  const onBlockKey = (e: KeyboardEvent<HTMLDivElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectAndPlay(id, e);
    }
  };

  // ---------- marquee on empty lane ----------
  const laneXY = (e: { clientX: number; clientY: number }) => {
    const r = laneRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onLaneDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = laneXY(e);
    marqueeRef.current = {
      pointerId: e.pointerId,
      x0: x,
      y0: y,
      base: e.shiftKey ? store.getState().selection : [],
      moved: false,
    };
  };
  const onLaneMove = (e: PointerEvent<HTMLDivElement>) => {
    const m = marqueeRef.current;
    if (!m || e.pointerId !== m.pointerId) return;
    const { x, y } = laneXY(e);
    if (!m.moved && Math.hypot(x - m.x0, y - m.y0) < DRAG_THRESHOLD_PX) return;
    m.moved = true;
    const rect = { x: Math.min(x, m.x0), y: Math.min(y, m.y0), w: Math.abs(x - m.x0), h: Math.abs(y - m.y0) };
    setMarquee(rect);
    const p = ppsRef.current;
    const hit = itemsRef.current
      .filter((it) => {
        const l = msToPx(it.startMs, p);
        const r = l + Math.max(4, msToPx(it.endMs - it.startMs, p));
        const t = rowTop(it.row);
        return l < rect.x + rect.w && r > rect.x && t < rect.y + rect.h && t + ROW_H > rect.y;
      })
      .map((it) => it.id);
    store.select([...new Set([...m.base, ...hit])]);
  };
  const onLaneUp = (e: PointerEvent<HTMLDivElement>) => {
    const m = marqueeRef.current;
    if (!m || e.pointerId !== m.pointerId) return;
    marqueeRef.current = null;
    setMarquee(null);
    if (!m.moved && !e.shiftKey) store.clearSelection();
  };

  // ---------- drop from lyrics list ----------
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(LINE_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const ms = Math.round(xToMs(e.clientX));
    setDropMs((prev) => (prev === ms ? prev : ms));
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropMs(null);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const id = e.dataTransfer.getData(LINE_MIME);
    setDropMs(null);
    if (!id) return;
    e.preventDefault();
    const dur = durRef.current;
    const at = Math.round(xToMs(e.clientX));
    store.apply((d) => {
      if (!d.lines.some((l) => l.id === id)) return d;
      const seg = d.segments[id];
      const len = seg ? seg.endMs - seg.startMs : Math.min(ops.DEFAULT_SEGMENT_MS, dur);
      const start = Math.max(0, Math.min(at, dur - len));
      return ops.setTimes(d, id, start, start + len, dur);
    });
  };

  if (!doc) {
    return <div className={styles.empty}>No project loaded.</div>;
  }

  const lh = laneHeight(rows);
  return (
    <div className={styles.root} data-testid="timeline">
      <div ref={scrollRef} className={styles.scroll} onScroll={onScroll} onPointerDownCapture={() => (lastUserScroll.current = performance.now())}>
        <div
          ref={contentRef}
          className={styles.content}
          style={{ width: contentW }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className={styles.ruler} style={{ height: RULER_H }} onPointerDown={onScrubDown} onPointerMove={onScrubMove} aria-label="Time ruler" role="presentation">
            <canvas ref={rulerCv} className={styles.sticky} />
          </div>
          <div className={styles.wave} style={{ height: WAVE_H }} onPointerDown={onScrubDown} onPointerMove={onScrubMove} role="img" aria-label="Waveform">
            <canvas ref={waveCv} className={styles.sticky} />
            {peaksStatus === 'error' && (
              <div className={styles.notice} role="status">Waveform unavailable (audio could not be decoded)</div>
            )}
            {peaksStatus === 'loading' && <div className={styles.notice} role="status">Decoding waveform…</div>}
          </div>
          <div
            ref={laneRef}
            className={styles.lane}
            style={{ height: lh }}
            data-testid="segment-lane"
            onPointerDown={onLaneDown}
            onPointerMove={onLaneMove}
            onPointerUp={onLaneUp}
            onPointerCancel={onLaneUp}
          >
            {drag?.ghosts.map((g) => (
              <div
                key={`ghost-${g.id}`}
                className={styles.ghost}
                style={{ left: msToPx(g.startMs, pps), width: Math.max(4, msToPx(g.endMs - g.startMs, pps)), top: rowTop(g.row), height: ROW_H }}
              />
            ))}
            {items.map((it) => {
              const selected = selSet.has(it.id);
              return (
                <div
                  key={it.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Segment: ${it.text}`}
                  aria-pressed={selected}
                  data-line-id={it.id}
                  data-selected={selected || undefined}
                  data-cursor={cursorId === it.id || undefined}
                  title={`${it.index + 1}. ${it.text}\n${formatMs(it.startMs)} – ${formatMs(it.endMs)}`}
                  className={styles.block}
                  style={{
                    left: msToPx(it.startMs, pps),
                    width: Math.max(4, msToPx(it.endMs - it.startMs, pps)),
                    top: rowTop(it.row),
                    height: ROW_H,
                  }}
                  onPointerDown={(e) => onBlockDown(e, it.id)}
                  onPointerMove={onBlockMove}
                  onPointerUp={(e) => onBlockUp(e, it.id)}
                  onPointerCancel={() => endDrag(true)}
                  onKeyDown={(e) => onBlockKey(e, it.id)}
                >
                  <span className={styles.edge} data-edge="start" style={{ width: EDGE_PX }} aria-hidden="true" />
                  <span className={styles.label}>
                    <span className={styles.num}>{it.index + 1}</span>
                    {it.text}
                  </span>
                  <span className={`${styles.edge} ${styles.edgeEnd}`} data-edge="end" style={{ width: EDGE_PX }} aria-hidden="true" />
                </div>
              );
            })}
            {marquee && (
              <div className={styles.marquee} style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
            )}
          </div>

          {drag?.guideMs != null && <div className={styles.guide} style={{ left: msToPx(drag.guideMs, pps) }} data-testid="snap-guide" />}
          {dropMs !== null && <div className={styles.drop} style={{ left: msToPx(dropMs, pps) }} data-testid="drop-indicator" />}
          {drag && (
            <div className={styles.tip} style={{ left: drag.tip.x, top: RULER_H + WAVE_H - 24 }} role="status">
              {drag.tip.text}
            </div>
          )}
          <div ref={playheadRef} className={styles.playhead} data-testid="playhead" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

export default Timeline;

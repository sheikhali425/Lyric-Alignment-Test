/**
 * Singleton controller around one <audio> element, plus a tiny external store for {ms, playing}.
 * The rAF loop only runs while playing. Per-frame imperative consumers (canvas playhead) use
 * subscribeFrame and never touch React.
 */
import { msToSec, secToMs } from '../domain/time';
import { shallowEqual, useExternalSelector } from './external';

export interface PlaybackState {
  ms: number;
  playing: boolean;
}

let el: HTMLAudioElement | null = null;
let state: PlaybackState = { ms: 0, playing: false };
let rangeEndMs: number | null = null;
let raf = 0;
const listeners = new Set<() => void>();
const frameListeners = new Set<(ms: number) => void>();
let detachEl: (() => void) | null = null;

function publish() {
  const ms = getMs();
  const playing = isPlaying();
  if (ms !== state.ms || playing !== state.playing) {
    state = { ms, playing };
    listeners.forEach((l) => l());
  }
  frameListeners.forEach((f) => f(ms));
}

function tick() {
  raf = 0;
  if (!isPlaying()) {
    publish();
    return;
  }
  if (rangeEndMs !== null && getMs() >= rangeEndMs) {
    pause();
    return;
  }
  publish();
  raf = requestAnimationFrame(tick);
}

function startLoop() {
  if (!raf) raf = requestAnimationFrame(tick);
}

export function getMs(): number {
  return el ? secToMs(el.currentTime) : 0;
}

export function isPlaying(): boolean {
  return !!el && !el.paused && !el.ended;
}

export function attach(audio: HTMLAudioElement | null): () => void {
  detachEl?.();
  detachEl = null;
  el = audio;
  if (!audio) return () => {};
  const onPlay = () => {
    publish();
    startLoop();
  };
  const onStop = () => {
    rangeEndMs = null;
    publish();
  };
  const onSeek = () => publish();
  audio.addEventListener('play', onPlay);
  audio.addEventListener('playing', onPlay);
  audio.addEventListener('pause', onStop);
  audio.addEventListener('ended', onStop);
  audio.addEventListener('seeked', onSeek);
  audio.addEventListener('loadedmetadata', onSeek);
  detachEl = () => {
    audio.removeEventListener('play', onPlay);
    audio.removeEventListener('playing', onPlay);
    audio.removeEventListener('pause', onStop);
    audio.removeEventListener('ended', onStop);
    audio.removeEventListener('seeked', onSeek);
    audio.removeEventListener('loadedmetadata', onSeek);
    if (el === audio) el = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  publish();
  return detachEl;
}

export async function play(): Promise<void> {
  if (!el) return;
  try {
    await el.play();
  } catch {
    /* autoplay blocked or interrupted by a pause(); state events keep the UI consistent */
  }
  publish();
  if (isPlaying()) startLoop();
}

export function pause(): void {
  rangeEndMs = null;
  el?.pause();
  publish();
}

export function toggle(): void {
  if (isPlaying()) pause();
  else void play();
}

function seekInternal(ms: number) {
  if (!el) return;
  const max = Number.isFinite(el.duration) ? secToMs(el.duration) : Infinity;
  el.currentTime = msToSec(Math.min(Math.max(ms, 0), max));
  publish();
}

/** Seek. Cancels any playRange auto-pause (playback, if running, simply continues from the new spot). */
export function seek(ms: number): void {
  rangeEndMs = null;
  seekInternal(ms);
}

/** Play from startMs and auto-pause when endMs is reached. */
export function playRange(startMs: number, endMs: number): void {
  if (!el) return;
  seekInternal(startMs);
  rangeEndMs = endMs;
  void play();
}

export function subscribeFrame(cb: (ms: number) => void): () => void {
  frameListeners.add(cb);
  return () => frameListeners.delete(cb);
}

export const playback = {
  attach,
  play,
  pause,
  toggle,
  seek,
  playRange,
  getMs,
  isPlaying,
  subscribeFrame,
  getState: (): PlaybackState => state,
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export function usePlayback<T>(selector: (s: PlaybackState) => T, isEqual: (a: T, b: T) => boolean = shallowEqual): T {
  return useExternalSelector(playback.subscribe, playback.getState, selector, isEqual);
}

/**
 * View state that several components share but that is not part of the document:
 * zoom level and which modal is open. Not in undo history, not persisted.
 */
import { useExternalSelector } from './external';

export type Modal = null | 'load' | 'shortcuts';

export interface ViewState {
  /** Timeline scale in pixels per second of audio. */
  pxPerSec: number;
  /** Scale at which the whole track fits the timeline's width; zooming out stops here. */
  fitPxPerSec: number;
  modal: Modal;
}

/** Low enough that a long track still fits the viewport. */
export const MIN_PX_PER_SEC = 1;
export const MAX_PX_PER_SEC = 800;

let state: ViewState = { pxPerSec: 60, fitPxPerSec: MIN_PX_PER_SEC, modal: null };
const listeners = new Set<() => void>();

function set(next: ViewState) {
  state = next;
  listeners.forEach((l) => l());
}

export const view = {
  getState: (): ViewState => state,
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  setZoom(pxPerSec: number) {
    const z = Math.min(MAX_PX_PER_SEC, Math.max(state.fitPxPerSec, pxPerSec));
    if (z !== state.pxPerSec) set({ ...state, pxPerSec: z });
  },
  /**
   * Set the fit-to-width scale (called by the timeline on track change and resize). Zooming out
   * further would only shrink the song into the left of an otherwise empty, stretched lane.
   * `andZoom` also jumps to it, which is what opening a track wants.
   */
  setFit(fitPxPerSec: number, andZoom = false) {
    const fit = Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, fitPxPerSec));
    const z = andZoom ? fit : Math.max(fit, state.pxPerSec);
    if (fit !== state.fitPxPerSec || z !== state.pxPerSec) set({ ...state, fitPxPerSec: fit, pxPerSec: z });
  },
  /** factor > 1 zooms in. */
  zoomBy(factor: number) {
    view.setZoom(state.pxPerSec * factor);
  },
  openModal(modal: Modal) {
    if (modal !== state.modal) set({ ...state, modal });
  },
};

export function useView<T>(selector: (s: ViewState) => T): T {
  return useExternalSelector(view.subscribe, view.getState, selector);
}

import { useEffect, useState } from 'react';
import { decodePeaks, type Peaks } from '../audio/peaks';

export interface PeaksState {
  peaks: Peaks | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
}

/** Decode peaks for a URL (cached per URL). Failure leaves peaks null; callers draw a flat line. */
export function usePeaks(url: string | null | undefined): PeaksState {
  const [state, setState] = useState<PeaksState & { url: string | null | undefined }>({
    url,
    peaks: null,
    status: url ? 'loading' : 'idle',
    error: null,
  });
  useEffect(() => {
    if (!url) {
      setState({ url, peaks: null, status: 'idle', error: null });
      return;
    }
    let live = true;
    setState({ url, peaks: null, status: 'loading', error: null });
    decodePeaks(url).then(
      (peaks) => live && setState({ url, peaks, status: 'ready', error: null }),
      (err: unknown) => {
        if (!live) return;
        setState({ url, peaks: null, status: 'error', error: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      live = false;
    };
  }, [url]);
  // Never hand out peaks that belong to a previous URL.
  if (state.url !== url) return { peaks: null, status: url ? 'loading' : 'idle', error: null };
  return state;
}

import { useRef, useSyncExternalStore } from 'react';

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * useSyncExternalStore with a selector. The selected value is kept referentially stable
 * when `isEqual` says it did not change, so selectors may return fresh objects/arrays
 * (pass shallowEqual) without causing extra renders or snapshot loops.
 */
export function useExternalSelector<S, T>(
  subscribe: (cb: () => void) => () => void,
  getState: () => S,
  selector: (s: S) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const cache = useRef<{ state: S; selector: (s: S) => T; value: T } | null>(null);
  const getSnapshot = (): T => {
    const state = getState();
    const c = cache.current;
    if (c && c.state === state && c.selector === selector) return c.value;
    const value = selector(state);
    if (c && isEqual(c.value, value)) {
      cache.current = { state, selector, value: c.value };
      return c.value;
    }
    cache.current = { state, selector, value };
    return value;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

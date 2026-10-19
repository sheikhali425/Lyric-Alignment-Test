import { useExternalSelector } from '../../state/external';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function set(next: ToastItem[]) {
  items = next;
  listeners.forEach((l) => l());
}

export const toast = {
  getState: () => items,
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  /** Errors persist until dismissed; everything else clears itself after 5 s. */
  show(kind: ToastKind, message: string): number {
    const id = nextId++;
    set([...items.slice(-4), { id, kind, message }]);
    if (kind !== 'error') timers.set(id, setTimeout(() => toast.dismiss(id), 5000));
    return id;
  },
  info: (m: string) => toast.show('info', m),
  success: (m: string) => toast.show('success', m),
  warning: (m: string) => toast.show('warning', m),
  error: (m: string) => toast.show('error', m),
  dismiss(id: number) {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    set(items.filter((i) => i.id !== id));
  },
};

export function useToasts(): ToastItem[] {
  return useExternalSelector(toast.subscribe, toast.getState, (s) => s);
}

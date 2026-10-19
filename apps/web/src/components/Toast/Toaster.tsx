import { toast, useToasts } from './toastStore';
import s from './Toaster.module.css';

/** Render once near the app root. */
export function Toaster() {
  const items = useToasts();
  return (
    <div className={s.wrap} role="status" aria-live="polite" aria-relevant="additions">
      {items.map((t) => (
        <div key={t.id} className={`${s.toast} ${s[t.kind]}`} data-kind={t.kind}>
          <span className={s.msg}>{t.message}</span>
          <button type="button" className={s.close} aria-label="Dismiss notification" onClick={() => toast.dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

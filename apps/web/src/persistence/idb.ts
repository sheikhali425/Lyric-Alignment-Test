/** Minimal promise wrapper over IndexedDB, used only to keep audio Blobs. */
const DB_NAME = 'lyric-align';
const STORE = 'audio';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not support local audio storage (IndexedDB).'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(`Could not open local audio storage: ${req.error?.message ?? 'unknown error'}`));
    req.onblocked = () => reject(new Error('Local audio storage is blocked by another tab.'));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    let result: T;
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => resolve(result);
    const fail = () => {
      const err = tx.error ?? req.error;
      const quota = err?.name === 'QuotaExceededError';
      reject(
        new Error(
          quota
            ? 'Not enough browser storage space for this audio file. Try a smaller file or use an audio URL.'
            : `Local audio storage failed: ${err?.message ?? 'unknown error'}`,
        ),
      );
    };
    tx.onerror = fail;
    tx.onabort = fail;
  });
}

export function putBlob(key: string, blob: Blob): Promise<void> {
  return run('readwrite', (s) => s.put(blob, key)).then(() => undefined);
}

export function getBlob(key: string): Promise<Blob | undefined> {
  return run<Blob | undefined>('readonly', (s) => s.get(key));
}

export function deleteBlob(key: string): Promise<void> {
  return run('readwrite', (s) => s.delete(key)).then(() => undefined);
}

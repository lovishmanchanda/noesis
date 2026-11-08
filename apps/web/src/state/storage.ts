/** A tiny key-value store in the browser's own storage (IndexedDB). Nothing leaves the device. */
export interface Kv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

const DB = 'noesis';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser storage is not available'));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  job: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = job(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Browser storage failed'));
      }),
  );
}

export const browserKv: Kv = {
  get: <T>(key: string) => run('readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
  set: async (key, value) => {
    await run('readwrite', (s) => s.put(value, key));
  },
  del: async (key) => {
    await run('readwrite', (s) => s.delete(key));
  },
};

/** An in-memory store, for tests. */
export function memoryKv(): Kv & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: <T>(key: string) => Promise.resolve(data.get(key) as T | undefined),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    del: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
}

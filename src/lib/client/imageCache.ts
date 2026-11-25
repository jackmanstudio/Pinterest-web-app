/**
 * Demo-mode image storage in IndexedDB. Pin images are far too big for
 * localStorage (about 5 MB in total), so only a short "idb:" key is kept
 * with the draft and the image itself lives here.
 */
export interface ImageCache {
  put(key: string, dataUrl: string): Promise<void>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

const DB = "pin-ai-studio-images";
const STORE = "images";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open image storage"));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => reject(tx.error ?? new Error("Image storage failed"));
      }),
  );
}

export const indexedDbImageCache: ImageCache = {
  put: (key, dataUrl) => run("readwrite", (s) => s.put(dataUrl, key)).then(() => undefined),
  get: (key) => run<string | undefined>("readonly", (s) => s.get(key) as IDBRequest<string | undefined>).then((v) => v ?? null),
  remove: (key) => run("readwrite", (s) => s.delete(key)).then(() => undefined),
};

/** In-memory cache (tests, or browsers without IndexedDB). */
export function memoryImageCache(): ImageCache {
  const m = new Map<string, string>();
  return {
    put: async (k, v) => void m.set(k, v),
    get: async (k) => m.get(k) ?? null,
    remove: async (k) => void m.delete(k),
  };
}

// IndexedDB helper for the Deploy spike: write a value, read it back.
// Uses its own database name so it never collides with the real Tracker database
// ('achievement-tracker', task 9) on devices that installed the spike.

export const SPIKE_DB_NAME = 'achievement-tracker-spike';
export const SPIKE_DB_VERSION = 1;
export const SPIKE_STORE = 'spike';
export const SPIKE_KEY = 'lastWrite';

interface SpikeRecord {
  key: string;
  value: string;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** Opens (and on first use creates) the spike database. */
export function openSpikeDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(SPIKE_DB_NAME, SPIKE_DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SPIKE_STORE)) {
        db.createObjectStore(SPIKE_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Never block a later upgrade or deletion from another window.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
    request.onblocked = () => reject(new Error('Opening IndexedDB was blocked by another window'));
  });
}

/** Stores `value` in one readwrite transaction; resolves when the transaction commits. */
export async function writeSpikeValue(value: string, factory: IDBFactory = indexedDB): Promise<void> {
  const db = await openSpikeDb(factory);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SPIKE_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      const record: SpikeRecord = { key: SPIKE_KEY, value };
      tx.objectStore(SPIKE_STORE).put(record);
    });
  } finally {
    db.close();
  }
}

/** Reads the stored value, or `null` when nothing has been written yet. */
export async function readSpikeValue(factory: IDBFactory = indexedDB): Promise<string | null> {
  const db = await openSpikeDb(factory);
  try {
    const tx = db.transaction(SPIKE_STORE, 'readonly');
    const record = (await requestToPromise(tx.objectStore(SPIKE_STORE).get(SPIKE_KEY))) as
      | SpikeRecord
      | undefined;
    return record?.value ?? null;
  } finally {
    db.close();
  }
}

/** Writes `value`, then reads it back from a fresh connection. */
export async function writeThenRead(value: string, factory: IDBFactory = indexedDB): Promise<string | null> {
  await writeSpikeValue(value, factory);
  return readSpikeValue(factory);
}

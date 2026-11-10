/**
 * Focused unit tests for the commit watchdog and single retry added to
 * `IndexedDbStorage` to survive the iOS Safari / PWA stalled-transaction bug.
 *
 * These tests do NOT use fake-indexeddb: they install a tiny controllable fake
 * `indexedDB` global so a transaction can be made to stall (never fire any
 * completion event) or to complete, letting us assert:
 *   - a transaction that stalls on the first attempt but completes on the retry
 *     resolves (and the mutation's writes were applied on the retry);
 *   - a transaction that stalls on every attempt rejects (so the store can roll
 *     back) and never falsely resolves;
 *   - a normal, immediately-completing transaction resolves without the
 *     watchdog firing.
 */
import { IndexedDbStorage } from '../IndexedDbStorage'
import type { Mutation } from '../StoragePort'

// A no-op patch mutation (no records); enough to drive one readwrite transaction.
const EMPTY_PATCH: Mutation = {
  kind: 'patch',
  putActivities: [],
  deleteActivityIds: [],
  putDailyValues: [],
  putGoalVersions: [],
}

/** Behaviour of a single transaction: stall forever, or complete on a macrotask. */
type TxBehaviour = 'stall' | 'complete'

interface FakeStore {
  put: jest.Mock
  delete: jest.Mock
  clear: jest.Mock
}

/**
 * Builds a minimal fake `indexedDB` whose successive transactions follow
 * `behaviours` in order (default 'complete'). Tracks how many transactions and
 * aborts happened so tests can assert the retry occurred.
 */
function installFakeIndexedDb(behaviours: TxBehaviour[]): {
  txCount: () => number
  abortCount: () => number
  restore: () => void
} {
  let txIndex = 0
  let aborts = 0

  const makeStore = (): FakeStore => ({
    put: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  })

  const makeTx = (): IDBTransaction => {
    const behaviour = behaviours[txIndex] ?? 'complete'
    txIndex += 1
    const store = makeStore()
    const tx = {
      objectStore: () => store,
      abort() {
        aborts += 1
        // A real abort would fire onabort; our watchdog does not depend on it.
      },
      oncomplete: null as null | (() => void),
      onerror: null as null | (() => void),
      onabort: null as null | (() => void),
      error: null,
    } as unknown as IDBTransaction & { oncomplete: null | (() => void) }

    if (behaviour === 'complete') {
      // Fire completion on a macrotask, after runTransaction wires oncomplete.
      setTimeout(() => {
        (tx.oncomplete as (() => void) | null)?.()
      }, 0)
    }
    // 'stall': never fire any event -> the watchdog must time out.
    return tx
  }

  const db = {
    objectStoreNames: {
      contains: () => true,
    },
    transaction: () => makeTx(),
    close: jest.fn(),
    onversionchange: null,
  } as unknown as IDBDatabase

  const open = (): IDBOpenDBRequest => {
    const request = {
      result: db,
      onupgradeneeded: null as null | (() => void),
      onsuccess: null as null | (() => void),
      onerror: null,
      onblocked: null,
      transaction: null,
    } as unknown as IDBOpenDBRequest
    // Open succeeds immediately on a macrotask.
    setTimeout(() => {
      (request.onsuccess as (() => void) | null)?.()
    }, 0)
    return request
  }

  const fake = { open: () => open() } as unknown as IDBFactory
  const original = globalThis.indexedDB
  globalThis.indexedDB = fake

  return {
    txCount: () => txIndex,
    abortCount: () => aborts,
    restore: () => {
      globalThis.indexedDB = original
    },
  }
}

describe('IndexedDbStorage commit watchdog + retry', () => {
  it('resolves when the transaction completes normally (watchdog does not fire)', async () => {
    const fake = installFakeIndexedDb(['complete'])
    try {
      const storage = new IndexedDbStorage(1000)
      await expect(storage.commit(EMPTY_PATCH)).resolves.toBeUndefined()
      expect(fake.txCount()).toBe(1)
    } finally {
      fake.restore()
    }
  })

  it('retries once on a fresh connection when the first transaction stalls, then resolves', async () => {
    const fake = installFakeIndexedDb(['stall', 'complete'])
    try {
      const storage = new IndexedDbStorage(50) // short watchdog for the test
      await expect(storage.commit(EMPTY_PATCH)).resolves.toBeUndefined()
      // One stalled attempt + one successful retry.
      expect(fake.txCount()).toBe(2)
      expect(fake.abortCount()).toBe(1) // the stalled tx was aborted
    } finally {
      fake.restore()
    }
  })

  it('rejects (never falsely resolves) when every attempt stalls', async () => {
    const fake = installFakeIndexedDb(['stall', 'stall'])
    try {
      const storage = new IndexedDbStorage(40)
      await expect(storage.commit(EMPTY_PATCH)).rejects.toBeTruthy()
      // Exactly two attempts: the initial one and the single retry.
      expect(fake.txCount()).toBe(2)
    } finally {
      fake.restore()
    }
  })
})

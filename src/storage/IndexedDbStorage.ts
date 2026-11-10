/**
 * IndexedDB implementation of the `StoragePort` (design: Persistence —
 * `StoragePort` and `IndexedDbStorage`).
 *
 * `load` and `commit` (task 9.2) and `discard` plus connection handling
 * (task 9.3) all open a fresh connection per operation and close it when the
 * operation finishes. Every connection installs an `onversionchange` handler
 * that closes it, so a `deleteDatabase` or schema upgrade started in another
 * window of the Tracker is never blocked by an idle connection here (design:
 * Persistence — connection handling).
 *
 * Database `achievement-tracker` (DB_NAME) at version 1 (DB_VERSION) holds four
 * object stores created in `onupgradeneeded`: `meta` (schema version), and the
 * three data stores `activities`, `dailyValues`, `goalVersions` with the
 * compound key paths from `records.ts` (KEY_PATHS) that enforce the
 * one-per-key invariants I3. A single `meta` schema record is written on store
 * creation.
 *
 * Reads and writes use the standard IndexedDB API only, so the class runs
 * unchanged against `fake-indexeddb` in tests.
 */

import type { Dataset } from '../domain/dataset'
import {
  ALL_STORES,
  DATA_STORES,
  DB_NAME,
  DB_VERSION,
  KEY_PATHS,
  META_KEY,
  STORE_ACTIVITIES,
  STORE_DAILY_VALUES,
  STORE_GOAL_VERSIONS,
  STORE_META,
  datasetToRecords,
  schemaMetaRecord,
  toRawDataset,
  validateDatasetRules,
  type MetaRecord,
} from './records'
import type { DiscardError, LoadResult, Mutation, StoragePort } from './StoragePort'

/** Wrap an `IDBRequest` as a promise resolving with its `result`. */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/**
 * Wrap a `readwrite` transaction so the returned promise resolves only when the
 * transaction completes (Req 9.1, 9.6) and rejects on error or abort. The
 * caller issues the puts/deletes/clears synchronously inside `work`, which runs
 * before this function returns; the promise then tracks the transaction's final
 * event.
 */
function runTransaction(tx: IDBTransaction, work: () => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    try {
      work()
    } catch (error) {
      // A synchronous throw while queueing requests (e.g. a missing store or a
      // DataError on a bad key) aborts the transaction; surface the throw.
      try {
        tx.abort()
      } catch {
        // The transaction may already be finished; the reject below stands.
      }
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

/**
 * Default watchdog timeout (ms) for a single IndexedDB open or transaction
 * attempt. On iOS Safari and standalone PWAs an IndexedDB readwrite transaction
 * can occasionally stall and never fire `oncomplete`, `onerror` or `onabort`
 * (a long-standing WebKit bug), which would otherwise hang `commit` forever and
 * leave the UI stuck. The watchdog turns such a stall into a rejection so the
 * caller can retry on a fresh connection or roll back.
 */
const DEFAULT_IDB_TIMEOUT_MS = 8000

/** Error thrown when an IndexedDB open or transaction stalls past the watchdog. */
class IndexedDbTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`IndexedDB ${what} timed out after ${ms}ms`)
    this.name = 'IndexedDbTimeoutError'
  }
}

/**
 * Race a promise against a watchdog timer. If `promise` has not settled within
 * `ms`, the returned promise rejects with an {@link IndexedDbTimeoutError};
 * `onTimeout` runs so the caller can abort/close the stalled resources. The
 * timer is always cleared once either side settles. The watchdog never
 * *resolves* on timeout, so a stalled write is never reported as a success.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        onTimeout()
      } catch {
        // Best-effort cleanup; the rejection below is what matters.
      }
      reject(new IndexedDbTimeoutError(what, ms))
    }, ms)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

export class IndexedDbStorage implements StoragePort {
  /** Watchdog timeout (ms) per open/transaction attempt. Injected for tests. */
  private readonly timeoutMs: number

  /**
   * @param timeoutMs Per-attempt watchdog timeout (default
   *   {@link DEFAULT_IDB_TIMEOUT_MS}). `new IndexedDbStorage()` keeps the
   *   production default; tests may pass a small value.
   */
  constructor(timeoutMs: number = DEFAULT_IDB_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs
  }

  /**
   * Open the database, creating the stores and the `meta` record on first
   * creation (or on a version upgrade). A version mismatch where the stored
   * database is at a higher version than `DB_VERSION` makes `open` fail with a
   * `VersionError`; that rejection is treated as unreadable by `load`.
   */
  private openRaw(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }

      request.onupgradeneeded = () => {
        const db = request.result
        for (const store of ALL_STORES) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, { keyPath: KEY_PATHS[store] as string | string[] })
          }
        }
        // Seed the schema record inside the upgrade transaction so a freshly
        // created database already identifies its schema version.
        const tx = request.transaction
        if (tx !== null) {
          tx.objectStore(STORE_META).put(schemaMetaRecord())
        }
      }

      request.onsuccess = () => {
        const db = request.result
        // Close this connection if another window needs to upgrade or delete
        // the database, so our idle connection never blocks a discard or a
        // schema upgrade elsewhere (design: Persistence — connection handling).
        db.onversionchange = () => db.close()
        resolve(db)
      }
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
      request.onblocked = () => reject(new Error('IndexedDB open blocked'))
    })
  }

  /**
   * Open the database with the watchdog. If the open stalls past the timeout
   * the attempt rejects; if it resolves *after* the timeout (a very late event)
   * the connection is closed so it cannot leak and block later transactions.
   */
  private openDb(): Promise<IDBDatabase> {
    let opened: IDBDatabase | undefined
    const raw = this.openRaw().then((db) => {
      opened = db
      return db
    })
    return withTimeout(raw, this.timeoutMs, 'open', () => {
      // If the open settles late, make sure the connection is closed.
      raw.then((db) => db.close()).catch(() => {})
      if (opened) opened.close()
    })
  }

  /**
   * Read and validate the persisted Data_Set once at startup (design: Startup
   * flow). Any open failure, read failure, missing store, unknown schema
   * version or rule-validation failure yields `unreadable` with a short reason;
   * the stored data is never mutated here (Req 9.4).
   */
  async load(): Promise<LoadResult> {
    let db: IDBDatabase
    try {
      db = await this.openDb()
    } catch (error) {
      // Open failed (including a higher stored schema version): unreadable.
      return { status: 'unreadable', reason: describe(error, 'The saved data could not be opened') }
    }

    try {
      // A structurally broken database missing an expected store is unreadable.
      for (const store of ALL_STORES) {
        if (!db.objectStoreNames.contains(store)) {
          return { status: 'unreadable', reason: `The saved data is missing the "${store}" store` }
        }
      }

      let meta: MetaRecord | undefined
      let activities: unknown[]
      let dailyValues: unknown[]
      let goalVersions: unknown[]
      try {
        const tx = db.transaction(ALL_STORES as unknown as string[], 'readonly')
        meta = await requestToPromise(
          tx.objectStore(STORE_META).get(META_KEY) as IDBRequest<MetaRecord | undefined>,
        )
        activities = await requestToPromise(
          tx.objectStore(STORE_ACTIVITIES).getAll() as IDBRequest<unknown[]>,
        )
        dailyValues = await requestToPromise(
          tx.objectStore(STORE_DAILY_VALUES).getAll() as IDBRequest<unknown[]>,
        )
        goalVersions = await requestToPromise(
          tx.objectStore(STORE_GOAL_VERSIONS).getAll() as IDBRequest<unknown[]>,
        )
      } catch (error) {
        return { status: 'unreadable', reason: describe(error, 'The saved data could not be read') }
      }

      // An unknown schema version is unreadable: a database written by a newer
      // App_Version (or a corrupt/missing meta record) is left untouched.
      if (meta === undefined || meta.version !== DB_VERSION) {
        return { status: 'unreadable', reason: 'The saved data uses an unknown schema version' }
      }

      // No records at all: start with an empty Data_Set and no error (Req 9.5).
      if (activities.length === 0 && dailyValues.length === 0 && goalVersions.length === 0) {
        return { status: 'empty' }
      }

      // Validate the raw records with the load codec (integer milli values).
      const result = validateDatasetRules(
        toRawDataset(activities, dailyValues, goalVersions),
        'milli',
      )
      if (!result.ok) {
        return { status: 'unreadable', reason: result.error.problem }
      }

      return { status: 'loaded', dataset: result.value }
    } finally {
      db.close()
    }
  }

  /**
   * Persist one `Mutation` in a single `readwrite` transaction, resolving only
   * when the transaction completes and rejecting on error or abort (Req 9.1,
   * 9.6, 9.13, 12.13, 12.19). A `patch` applies puts and cascading deletes; a
   * `replaceAll` clears the data stores and rewrites them plus the `meta`
   * record.
   */
  async commit(mutation: Mutation): Promise<void> {
    // iOS Safari / standalone PWAs occasionally stall an IndexedDB readwrite
    // transaction so it never fires any completion event, which would hang this
    // promise forever (Req 9.1/9.6 would never be satisfied). The watchdog in
    // `commitOnce` turns a stall into a rejection; a single retry on a FRESH
    // connection clears the (usually transient) stall. Only a real
    // `tx.oncomplete` resolves, so success is never reported for unwritten data.
    try {
      await this.commitOnce(mutation)
    } catch (firstError) {
      // Retry once on a brand-new connection; iOS stalls rarely survive this.
      try {
        await this.commitOnce(mutation)
      } catch {
        // Surface the original failure so the store rolls back the optimistic
        // state and the UI shows the "not saved" notice.
        throw firstError instanceof Error ? firstError : new Error(String(firstError))
      }
    }
  }

  /**
   * One commit attempt: open a fresh connection, run the mutation in a single
   * `readwrite` transaction, and resolve only on `tx.oncomplete`. The whole
   * attempt is bounded by the watchdog; on timeout the transaction is aborted
   * (best-effort) and the connection closed, and the attempt rejects. The
   * connection is always closed before returning so a stalled attempt cannot
   * leak a handle that blocks the retry (a common iOS failure mode).
   */
  private async commitOnce(mutation: Mutation): Promise<void> {
    const db = await this.openDb()
    // `replaceAll` also rewrites `meta`; `patch` touches only the data stores.
    const stores =
      mutation.kind === 'replaceAll'
        ? (ALL_STORES as unknown as string[])
        : (DATA_STORES as unknown as string[])
    let tx: IDBTransaction | undefined
    try {
      const run = runTransaction((tx = db.transaction(stores, 'readwrite')), () => {
        if (mutation.kind === 'replaceAll') {
          applyReplaceAll(tx as IDBTransaction, mutation.dataset)
        } else {
          applyPatch(tx as IDBTransaction, mutation)
        }
      })
      await withTimeout(run, this.timeoutMs, 'commit transaction', () => {
        // Abort the stalled transaction so it cannot commit late after we have
        // already rejected and (on retry) written the same data again.
        try {
          tx?.abort()
        } catch {
          // Already finished; ignore.
        }
      })
    } finally {
      db.close()
    }
  }

  /**
   * Delete all persisted data atomically in recovery mode (Req 9.11, design:
   * Discard flow). Two paths:
   *
   * 1. Preferred: open the database and, in one `readwrite` transaction over
   *    all four stores, `clear()` each and (re)put the `meta` schema record.
   *    This works whenever the stores can be opened, which covers corrupt
   *    records and failed validation (the common cases). IndexedDB transaction
   *    atomicity means a crash leaves either all old (unreadable) records or
   *    none. Resolves on `complete`; `error`/`abort` rejects with `'failed'`.
   * 2. Fallback: only when path 1 cannot start — `open()` fails (e.g. a
   *    `VersionError` after a downgrade) or `transaction()` throws because a
   *    store is missing. Close our own connection and call
   *    `indexedDB.deleteDatabase(DB_NAME)`. `success` resolves; `error` rejects
   *    with `'failed'`; `blocked` (another open window) rejects with
   *    `'blocked'`. The database is recreated lazily by the next `commit`.
   *
   * On failure the rejection value is a `DiscardError` (`'failed'` or
   * `'blocked'`), so `TrackerStore` can keep the Tracker in recovery mode and
   * show the matching message (Req 9.13).
   */
  async discard(): Promise<void> {
    let db: IDBDatabase
    try {
      db = await this.openDb()
    } catch {
      // Path 2: the database could not be opened at all.
      return deleteDatabase()
    }

    // A structurally broken database missing an expected store cannot be
    // cleared in a transaction; fall back to deleting the whole database.
    for (const store of ALL_STORES) {
      if (!db.objectStoreNames.contains(store)) {
        db.close()
        return deleteDatabase()
      }
    }

    try {
      const tx = db.transaction(ALL_STORES as unknown as string[], 'readwrite')
      await runTransaction(tx, () => {
        for (const store of DATA_STORES) {
          tx.objectStore(store).clear()
        }
        tx.objectStore(STORE_META).clear()
        tx.objectStore(STORE_META).put(schemaMetaRecord())
      })
    } catch {
      // A transaction error or abort leaves the data as it was (Req 9.13).
      throw 'failed' satisfies DiscardError
    } finally {
      db.close()
    }
  }
}

/**
 * Delete the whole `achievement-tracker` database (discard path 2). Resolves on
 * `success`; rejects with the `DiscardError` `'blocked'` when another open
 * connection holds the database (`onblocked`), and `'failed'` on `error`. The
 * next `commit` recreates the database through the normal `onupgradeneeded`
 * path (design: Discard flow).
 */
function deleteDatabase(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.deleteDatabase(DB_NAME)
    } catch {
      reject('failed' satisfies DiscardError)
      return
    }
    request.onsuccess = () => resolve()
    request.onerror = () => reject('failed' satisfies DiscardError)
    request.onblocked = () => reject('blocked' satisfies DiscardError)
  })
}

/**
 * Apply a `patch` inside an open transaction: put activities, daily values and
 * goal versions, and delete the given Activities together with their
 * Daily_Values and Goal_Versions. Cascading deletes use `IDBKeyRange.bound` on
 * the compound keys, whose first element is the `activityId`, so every record
 * belonging to the Activity is covered without scanning.
 */
function applyPatch(
  tx: IDBTransaction,
  mutation: Extract<Mutation, { kind: 'patch' }>,
): void {
  const activitiesStore = tx.objectStore(STORE_ACTIVITIES)
  const dailyValuesStore = tx.objectStore(STORE_DAILY_VALUES)
  const goalVersionsStore = tx.objectStore(STORE_GOAL_VERSIONS)

  // Deletes first so a delete + re-put of the same Activity keeps the puts.
  for (const activityId of mutation.deleteActivityIds) {
    activitiesStore.delete(activityId)
    // Compound keys are [activityId, ...]; bound from [id] to [id, []] covers
    // every (activityId, *) record (IDBKeyRange, design: Persistence).
    dailyValuesStore.delete(IDBKeyRange.bound([activityId], [activityId, []]))
    goalVersionsStore.delete(IDBKeyRange.bound([activityId], [activityId, []]))
  }

  for (const activity of mutation.putActivities) {
    activitiesStore.put(activity)
  }
  for (const dailyValue of mutation.putDailyValues) {
    dailyValuesStore.put(dailyValue)
  }
  for (const goalVersion of mutation.putGoalVersions) {
    goalVersionsStore.put(goalVersion)
  }
}

/**
 * Apply a `replaceAll` inside an open transaction: clear the three data stores
 * and write the new Dataset's records, then (re)write the `meta` schema record.
 * Clearing works even when the previous records were unreadable, which is what
 * replaces corrupt data on import (Req 12.13, 12.19).
 */
function applyReplaceAll(tx: IDBTransaction, dataset: Dataset): void {
  const activitiesStore = tx.objectStore(STORE_ACTIVITIES)
  const dailyValuesStore = tx.objectStore(STORE_DAILY_VALUES)
  const goalVersionsStore = tx.objectStore(STORE_GOAL_VERSIONS)

  activitiesStore.clear()
  dailyValuesStore.clear()
  goalVersionsStore.clear()

  const records = datasetToRecords(dataset)
  for (const activity of records.activities) {
    activitiesStore.put(activity)
  }
  for (const dailyValue of records.dailyValues) {
    dailyValuesStore.put(dailyValue)
  }
  for (const goalVersion of records.goalVersions) {
    goalVersionsStore.put(goalVersion)
  }

  tx.objectStore(STORE_META).put(schemaMetaRecord())
}

/** A short human-readable reason from a caught error, with a fallback. */
function describe(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) {
    return `${fallback}: ${error.message}`
  }
  return fallback
}

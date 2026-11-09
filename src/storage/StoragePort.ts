/**
 * Storage interface the application layer depends on (design: Persistence —
 * `StoragePort` and `IndexedDbStorage`). This module owns the canonical
 * declarations of the `Mutation` and `LoadResult` types; `commands.ts` mirrors
 * `Mutation` locally so the domain core type-checks on its own, and the two
 * declarations are kept structurally identical.
 *
 * The interface is deliberately free of IndexedDB specifics so the state layer
 * can be tested against a simple test double whose `commit` and `discard` can
 * be made to reject (design: Testing Strategy — store properties 24, 25, 34).
 * The concrete `IndexedDbStorage` implements this port in a later task.
 *
 * Only types and an interface live here; there is no runtime behaviour and no
 * I/O.
 */

import type { Activity, DailyValue, Dataset, GoalVersion } from '../domain/dataset'

/**
 * The storage mutation a committed command must persist (design: Persistence).
 *
 * - `patch` applies puts and cascading deletes in one transaction. Deleting an
 *   Activity cascades to its Daily_Values and Goal_Versions at the storage
 *   level (via `deleteActivityIds`).
 * - `replaceAll` replaces the whole Data_Set in one transaction (Backup_File
 *   import, Req 12.13, 12.19).
 *
 * Canonical declaration: identical in shape to the local `Mutation` in
 * `src/domain/commands.ts`. No field differs, so no reconciliation of
 * `commands.ts` is required.
 */
export type Mutation =
  | {
      kind: 'patch'
      putActivities: Activity[]
      /** Cascades to the Activity's Daily_Values and Goal_Versions. */
      deleteActivityIds: string[]
      putDailyValues: DailyValue[]
      putGoalVersions: GoalVersion[]
    }
  | { kind: 'replaceAll'; dataset: Dataset }

/**
 * The outcome of reading the persisted data at startup (design: Startup flow).
 *
 * - `empty`: no database or empty stores; start with an empty Data_Set and no
 *   error (Req 9.5).
 * - `loaded`: a well-formed Data_Set read back and validated (Req 9.2, 9.3).
 * - `unreadable`: the open failed, a store was missing, the schema version was
 *   unknown, or validation failed; the Tracker starts empty in the
 *   Unreadable_Data_State (recovery mode) and leaves the data untouched until a
 *   confirmed import or discard (Req 9.4). `reason` is a short human-readable
 *   explanation for the startup error banner.
 */
export type LoadResult =
  | { status: 'empty' }
  | { status: 'loaded'; dataset: Dataset }
  | { status: 'unreadable'; reason: string }

/**
 * Why a `discard` failed (design: Discard flow). `failed` is a transaction
 * error/abort or a `deleteDatabase` error; `blocked` means another open
 * connection (another window of the Tracker) is holding the database open.
 */
export type DiscardError = 'failed' | 'blocked'

/**
 * The persistence port the `TrackerStore` talks to.
 *
 * - `load` reads and validates the persisted Data_Set once at startup.
 * - `commit` persists one `Mutation` in a single atomic transaction, resolving
 *   only when the transaction completes and rejecting on error or abort (Req
 *   9.1, 9.6).
 * - `discard` deletes all persisted data atomically in recovery mode (Req
 *   9.11); it rejects with a `DiscardError` on failure.
 */
export interface StoragePort {
  load(): Promise<LoadResult>
  commit(mutation: Mutation): Promise<void>
  discard(): Promise<void>
}

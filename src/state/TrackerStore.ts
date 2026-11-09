/**
 * Framework-agnostic application store for the Achievement Tracker (design:
 * Application — `TrackerStore`).
 *
 * The store owns the single source of truth the UI renders: the published
 * `Dataset`, whether the Tracker runs in `normal` or `recovery` mode, the
 * startup error banner text, the current `today` and the latest transient
 * notice. It is deliberately free of React and of IndexedDB specifics: it talks
 * to a `StoragePort` and exposes a `subscribe` / `getSnapshot` pair shaped for
 * React's `useSyncExternalStore` (`useTracker.ts`). It can therefore be driven
 * directly in property tests with a test-double port whose `commit` and
 * `discard` are made to reject (design: Testing Strategy — store properties
 * 24, 25, 31, 34).
 *
 * Update model (design: Change flow — "Commit-then-apply"):
 * `dispatch` runs `applyCommand` against the current published `Dataset`. A
 * rejected command surfaces its `CommandError` and never touches state
 * (Property 4). An accepted command optimistically publishes the new `Dataset`,
 * then awaits `storage.commit(mutation)`; on commit success the optimistic
 * state stands, and on commit failure the store rolls back to the exact
 * `Dataset` published before the command so memory never diverges from storage
 * (Req 1.10, 3.8, 8.13, 9.7, 12.16; Property 24). A successful `importDataset`
 * also leaves recovery mode (Req 12.20; Property 31).
 *
 * In `recovery` mode (the Unreadable_Data_State) every command other than
 * `importDataset` is refused with `notSaved('recovery')` without any storage
 * call, keeping the unreadable data untouched (Req 9.4, 9.14; Property 25).
 *
 * Commands and the discard both run through a single promise queue, so each is
 * validated against the state produced by the previous committed operation and
 * memory and storage stay in lockstep (design: "processed one at a time through
 * a promise queue").
 */

import type { Command, CommandContext, CommandError } from '../domain/commands'
import { applyCommand } from '../domain/commands'
import type { Dataset } from '../domain/dataset'
import { emptyDataset } from '../domain/dataset'
import type { LocalDate } from '../domain/calendar'
import { todayLocal } from '../domain/calendar'
import type { DiscardError, StoragePort } from '../storage/StoragePort'

/**
 * The load/run state the UI renders.
 *
 * - `loading`: `init()` has not resolved yet; show a loading state (Req 9.2).
 * - `ready`: the Tracker is running. `mode` is `normal` once data has loaded
 *   (or after a confirmed import/discard), or `recovery` while the persisted
 *   data is unreadable (Req 9.4). `startupError` is the recovery banner text,
 *   or `null` in normal mode.
 */
export type LoadState =
  | { phase: 'loading' }
  | {
      phase: 'ready'
      dataset: Dataset
      mode: 'normal' | 'recovery'
      startupError: string | null
    }

/**
 * The outcome of a `dispatch` (design: `CommandResult`).
 *
 * - `saved`: validated and committed; the new `Dataset` is published.
 * - `rejected`: `applyCommand` refused the command; state is unchanged and the
 *   UI shows the field error and keeps the input.
 * - `notSaved`: either the commit failed and the state was rolled back
 *   (`commitFailed`), or a non-import command was attempted in recovery mode
 *   (`recovery`). The input is kept in both cases.
 */
export type CommandResult =
  | { status: 'saved' }
  | { status: 'rejected'; error: CommandError }
  | { status: 'notSaved'; reason: 'commitFailed' | 'recovery' }

/** The outcome of `discardUnreadable` (design: Discard flow). */
export type DiscardResult =
  | { status: 'discarded' }
  | { status: 'notDiscarded'; reason: DiscardError }

/**
 * A transient message for the `aria-live` region (design: Snapshot — `notice`).
 * `kind` lets the UI pick the wording from its message table; the store keeps
 * only the classification, not the copy.
 */
export type Notice =
  | { kind: 'commitFailed' }
  | { kind: 'recovery' }
  | { kind: 'discardFailed'; reason: DiscardError }

/** The immutable value React reads on every render (design: `getSnapshot`). */
export interface Snapshot {
  load: LoadState
  today: LocalDate
  notice: Notice | null
}

/**
 * The persistence-backed application store. Constructed with a `StoragePort`
 * plus a clock and an id factory (injected so the store and command layer stay
 * pure and testable), as the design's constructor specifies.
 */
export class TrackerStore {
  private readonly storage: StoragePort
  private readonly clock: () => Date
  private readonly newId: () => string

  private snapshot: Snapshot
  private readonly listeners = new Set<() => void>()

  /**
   * The tail of the operation queue. Every `dispatch` and `discardUnreadable`
   * chains onto it so operations run strictly one at a time (design: promise
   * queue). `init()` seeds the chain.
   */
  private queue: Promise<void> = Promise.resolve()

  constructor(storage: StoragePort, clock: () => Date, newId: () => string) {
    this.storage = storage
    this.clock = clock
    this.newId = newId
    this.snapshot = {
      load: { phase: 'loading' },
      today: todayLocal(clock()),
      notice: null,
    }
  }

  /**
   * Load the persisted Data_Set once at startup (design: Startup flow). Runs on
   * the operation queue so no dispatch can race the initial load. Maps the
   * `LoadResult` to the published state:
   * - `loaded`: normal mode with the loaded Dataset (Req 9.2).
   * - `empty`: normal mode with an empty Dataset and no error (Req 9.5).
   * - `unreadable`: recovery mode with an empty Dataset and the banner reason
   *   (Req 9.4).
   */
  init(): Promise<void> {
    return this.enqueue(async () => {
      const result = await this.storage.load()
      if (result.status === 'loaded') {
        this.setReady(result.dataset, 'normal', null)
      } else if (result.status === 'empty') {
        this.setReady(emptyDataset(), 'normal', null)
      } else {
        this.setReady(emptyDataset(), 'recovery', result.reason)
      }
    })
  }

  /** Register a snapshot listener; returns an unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** The current immutable snapshot (stable identity until something changes). */
  getSnapshot = (): Snapshot => this.snapshot

  /**
   * Update `today` from the clock hook (design: Clock and date changes). A
   * no-op when the date is unchanged, so an unchanged tick never re-renders.
   * All today-derived values (today's Daily_Value, Current_Period, Goal_Status,
   * editability) flow from this (Req 2.8, 12.23).
   */
  setToday(today: LocalDate): void {
    if (today === this.snapshot.today) return
    this.publish({ ...this.snapshot, today })
  }

  /**
   * Validate and persist one command (design: Change flow).
   *
   * Enqueued so it runs after every earlier operation. Recovery mode refuses
   * any non-import command with `notSaved('recovery')` and makes no storage
   * call (Req 9.14). Otherwise the new state is published optimistically and
   * `storage.commit` is awaited; a commit failure rolls the published state
   * back to the pre-command Dataset (Req 1.10, 3.8, 8.13, 9.7, 12.16).
   */
  dispatch(cmd: Command): Promise<CommandResult> {
    return this.enqueue(() => this.runCommand(cmd))
  }

  /**
   * Discard the unreadable persisted data and start fresh (Req 9.11, 9.12,
   * design: Discard flow). Only meaningful in recovery mode; a no-op that
   * reports success otherwise. On `storage.discard` success it publishes an
   * empty Dataset in normal mode and clears the banner (Req 9.12); on a
   * `DiscardError` it stays in recovery mode and records the matching notice so
   * the UI can show "failed" or "blocked" (Req 9.13). The dialog calls this
   * only after the user confirms, so a cancelled confirmation never reaches the
   * store (Req 9.10).
   */
  discardUnreadable(): Promise<DiscardResult> {
    return this.enqueue(() => this.runDiscard())
  }

  // --- internals ----------------------------------------------------------

  /** The current CommandContext built from `today`, the clock and the id factory. */
  private context(): CommandContext {
    return {
      today: this.snapshot.today,
      now: this.clock().toISOString(),
      newId: this.newId,
    }
  }

  /** Run a command once it reaches the front of the queue (design: Change flow). */
  private async runCommand(cmd: Command): Promise<CommandResult> {
    const load = this.snapshot.load
    // Commands only apply once the Tracker is ready; `init` runs first on the
    // same queue, so `loading` is not reachable here in practice.
    if (load.phase !== 'ready') {
      return { status: 'notSaved', reason: 'recovery' }
    }

    // Recovery mode: only an import may write (Req 9.14, Property 25).
    if (load.mode === 'recovery' && cmd.kind !== 'importDataset') {
      this.publish({ ...this.snapshot, notice: { kind: 'recovery' } })
      return { status: 'notSaved', reason: 'recovery' }
    }

    const result = applyCommand(load.dataset, cmd, this.context())
    if (!result.ok) {
      // A rejected command never changes the published Dataset (Property 4).
      return { status: 'rejected', error: result.error }
    }

    // Optimistically publish the new Dataset, remembering the previous one so a
    // commit failure can roll back to it exactly (design: Change flow).
    const previous = load.dataset
    const nextMode = cmd.kind === 'importDataset' ? 'normal' : load.mode
    const nextStartupError = cmd.kind === 'importDataset' ? null : load.startupError
    this.setReady(result.next, nextMode, nextStartupError, null)

    try {
      await this.storage.commit(result.mutation)
      return { status: 'saved' }
    } catch {
      // Roll back to the last persisted state; a later command is validated
      // against this unchanged Dataset (Req 9.7, Property 24). An import that
      // fails to persist also keeps the previous mode and banner (Req 12.16).
      this.setReady(previous, load.mode, load.startupError, { kind: 'commitFailed' })
      return { status: 'notSaved', reason: 'commitFailed' }
    }
  }

  /** Run a discard once it reaches the front of the queue (design: Discard flow). */
  private async runDiscard(): Promise<DiscardResult> {
    const load = this.snapshot.load
    // Outside recovery mode a discard is a no-op reported as success.
    if (load.phase !== 'ready' || load.mode !== 'recovery') {
      return { status: 'discarded' }
    }

    try {
      await this.storage.discard()
      // Leave recovery mode with an empty Data_Set; further changes persist as
      // usual (Req 9.12, Property 34).
      this.setReady(emptyDataset(), 'normal', null, null)
      return { status: 'discarded' }
    } catch (error) {
      // Stay in recovery mode; the persisted data is unchanged (Req 9.13). The
      // port rejects with a `DiscardError` (`'failed'` or `'blocked'`).
      const reason = normaliseDiscardError(error)
      this.publish({ ...this.snapshot, notice: { kind: 'discardFailed', reason } })
      return { status: 'notDiscarded', reason }
    }
  }

  /**
   * Chain `work` onto the operation queue so operations never overlap. The
   * queue tail always resolves (its errors are swallowed for sequencing only);
   * each caller still receives its own operation's resolved value or rejection.
   */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Publish a `ready` state, keeping the current `today` and setting the notice. */
  private setReady(
    dataset: Dataset,
    mode: 'normal' | 'recovery',
    startupError: string | null,
    notice: Notice | null = this.snapshot.notice,
  ): void {
    this.publish({
      load: { phase: 'ready', dataset, mode, startupError },
      today: this.snapshot.today,
      notice,
    })
  }

  /** Replace the snapshot and notify every listener (design: `useSyncExternalStore`). */
  private publish(snapshot: Snapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) {
      listener()
    }
  }
}

/**
 * Narrow a caught discard rejection to a `DiscardError`. `IndexedDbStorage`
 * rejects with the string `'failed'` or `'blocked'`; anything else is treated
 * as a generic failure so the UI still leaves recovery mode intact.
 */
function normaliseDiscardError(error: unknown): DiscardError {
  return error === 'blocked' ? 'blocked' : 'failed'
}

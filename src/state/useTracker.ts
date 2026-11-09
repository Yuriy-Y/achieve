/**
 * React bindings for the `TrackerStore` (design: Application layer).
 *
 * A single `TrackerStore` instance is shared through a React context created by
 * `TrackerProvider`. Components read the store's snapshot with
 * `useSyncExternalStore`, so a committed change re-renders the list and chart in
 * the same frame (Req 2.7, 3.2, 4.2, 7.10, 11.6, 12.14), and call the action
 * callbacks returned by `useTrackerActions` to drive changes.
 *
 * The action callbacks take only the user's raw input. The CommandContext
 * (`today`, `now`, `newId = crypto.randomUUID`) is built inside the store from
 * its injected clock and id factory, so callers never assemble it themselves
 * (design: `TrackerStore`, `CommandContext`). Each callback maps one-to-one to a
 * `Command` and returns the store's `CommandResult`, which the component uses to
 * decide whether to clear its input or keep it and show an error (Req 1.5, 1.10,
 * 3.8, 6.8, 8.13, 9.7, 9.14).
 *
 * This hook module owns only the store binding and the provider. `useToday`,
 * `useNumberDisplay` and `persistStorage` live in their own sibling modules and
 * are wired at the App level (tasks 10.2–10.4, 12.12).
 */

import { createContext, createElement, useCallback, useContext, useMemo } from 'react'
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { GoalType, LocalDate } from '../domain/calendar'
import type { Dataset } from '../domain/dataset'
import type { CommandResult, DiscardResult, Snapshot, TrackerStore } from './TrackerStore'

/**
 * The context holding the shared `TrackerStore`. `null` until a
 * `TrackerProvider` supplies one; the hooks throw a clear error if used
 * outside a provider.
 */
const TrackerStoreContext = createContext<TrackerStore | null>(null)

/** Props for `TrackerProvider`: the store instance and the subtree to wrap. */
export interface TrackerProviderProps {
  store: TrackerStore
  children: ReactNode
}

/**
 * Provides a single `TrackerStore` to the component tree. `App` creates the
 * store (with `IndexedDbStorage`, the real clock and `crypto.randomUUID`) and
 * wraps the tree in this provider (task 12.12). Written with `createElement`
 * rather than JSX so this `.ts` module needs no `.tsx` extension.
 */
export function TrackerProvider(props: TrackerProviderProps): ReactNode {
  return createElement(TrackerStoreContext.Provider, { value: props.store }, props.children)
}

/** The shared `TrackerStore`; throws if no `TrackerProvider` is above. */
export function useTrackerStore(): TrackerStore {
  const store = useContext(TrackerStoreContext)
  if (store === null) {
    throw new Error('useTrackerStore must be used within a TrackerProvider')
  }
  return store
}

/**
 * Subscribe to the store and return its current `Snapshot` (load state, today
 * and the latest notice). Backed by `useSyncExternalStore`, so React re-renders
 * the component whenever the store publishes a new snapshot.
 */
export function useTrackerSnapshot(): Snapshot {
  const store = useTrackerStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/**
 * The action callbacks a component uses to change the Tracker. Each wraps one
 * `Command` (or the discard path) and resolves with the store's result so the
 * caller can clear or keep its input accordingly. Identities are stable for the
 * lifetime of the store, so they are safe as effect dependencies.
 */
export interface TrackerActions {
  /** Create an Activity, optionally with a weekly and/or monthly goal (Req 1.1, 6.4). */
  createActivity(
    name: string,
    weeklyGoal?: string,
    monthlyGoal?: string,
  ): Promise<CommandResult>
  /** Rename an Activity (Req 1.6). */
  renameActivity(activityId: string, name: string): Promise<CommandResult>
  /** Delete an Activity and cascade to its values and goals (Req 1.9). */
  deleteActivity(activityId: string): Promise<CommandResult>
  /** Record or edit a Daily_Value for a Day (Req 3.2, 4.1). */
  recordValue(activityId: string, date: LocalDate, value: string): Promise<CommandResult>
  /** Set or change a weekly/monthly goal (Req 6.5, 6.6, 8.1, 8.2). */
  setGoal(activityId: string, goalType: GoalType, value: string): Promise<CommandResult>
  /** Remove a weekly/monthly goal (Req 8.4, 8.5). */
  removeGoal(activityId: string, goalType: GoalType): Promise<CommandResult>
  /** Replace the whole Data_Set with an already-validated imported Dataset (Req 12.13). */
  importDataset(dataset: Dataset): Promise<CommandResult>
  /** Discard unreadable persisted data and start fresh (Req 9.11, 9.12). */
  discardUnreadable(): Promise<DiscardResult>
}

/**
 * Build the memoised `TrackerActions` bound to the shared store. The command
 * builders send raw input straight to `store.dispatch`; the store parses,
 * validates and persists.
 */
export function useTrackerActions(): TrackerActions {
  const store = useTrackerStore()

  const createActivity = useCallback(
    (name: string, weeklyGoal?: string, monthlyGoal?: string) =>
      store.dispatch({ kind: 'createActivity', name, weeklyGoal, monthlyGoal }),
    [store],
  )
  const renameActivity = useCallback(
    (activityId: string, name: string) =>
      store.dispatch({ kind: 'renameActivity', activityId, name }),
    [store],
  )
  const deleteActivity = useCallback(
    (activityId: string) => store.dispatch({ kind: 'deleteActivity', activityId }),
    [store],
  )
  const recordValue = useCallback(
    (activityId: string, date: LocalDate, value: string) =>
      store.dispatch({ kind: 'recordValue', activityId, date, value }),
    [store],
  )
  const setGoal = useCallback(
    (activityId: string, goalType: GoalType, value: string) =>
      store.dispatch({ kind: 'setGoal', activityId, goalType, value }),
    [store],
  )
  const removeGoal = useCallback(
    (activityId: string, goalType: GoalType) =>
      store.dispatch({ kind: 'removeGoal', activityId, goalType }),
    [store],
  )
  const importDataset = useCallback(
    (dataset: Dataset) => store.dispatch({ kind: 'importDataset', dataset }),
    [store],
  )
  const discardUnreadable = useCallback(() => store.discardUnreadable(), [store])

  return useMemo(
    () => ({
      createActivity,
      renameActivity,
      deleteActivity,
      recordValue,
      setGoal,
      removeGoal,
      importDataset,
      discardUnreadable,
    }),
    [
      createActivity,
      renameActivity,
      deleteActivity,
      recordValue,
      setGoal,
      removeGoal,
      importDataset,
      discardUnreadable,
    ],
  )
}

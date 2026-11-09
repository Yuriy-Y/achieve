/**
 * `ActivityList` — the Tracker's main screen: the list of Activities (design:
 * UI components — `ActivityList` / `ActivityRow`, Req 2.1, 2.2, 2.3, 2.4, 2.5,
 * 2.7, 2.8, 11.5, 11.6).
 *
 * The list is derived by the pure `activityListModel(dataset, today,
 * numberDisplay)` (viewModels.ts), which orders rows by creation time (oldest
 * first, Req 2.2), carries today's stored value or 0 (Req 2.3) and a
 * `GoalSummary` for each Goal type with an Effective_Goal in its Current_Period
 * (Req 2.4). This component reads the live `Dataset` and `today` from the store
 * via `useTrackerSnapshot`, the locale formatter via `useNumberDisplay`, and the
 * `recordValue` action via `useTrackerActions`, so a committed change or a date
 * rollover re-renders the list within the same frame (Req 2.7, 2.8).
 *
 * When there are no Activities it shows an empty-state message together with a
 * "Create activity" control (Req 2.5). Each remaining Activity renders as an
 * `ActivityRow`; the list owns which single row's inline `QuickEntry` is open
 * (at most one at a time) while every other row stays visible (Req 11.5).
 *
 * The chart / goals / rename / delete actions and the create action are
 * delegated to the parent (`App`, task 12.12), which performs the state-based
 * navigation and renders the matching screens and dialogs. All layout and 44px
 * touch sizing come from CSS classes; no inline styles are used (CSP).
 */

import { useState } from 'react'
import type { ReactElement } from 'react'

import { activityListModel } from '../domain/viewModels'
import { useNumberDisplay } from '../state/useNumberDisplay'
import { useTrackerActions, useTrackerSnapshot } from '../state/useTracker'
import { ActivityRow } from './ActivityRow'

/** Props for {@link ActivityList}. */
export interface ActivityListProps {
  /** Start creating a new Activity (parent shows `ActivityForm`). */
  onCreateActivity: () => void
  /** Open the chart view for an Activity. */
  onOpenChart: (activityId: string) => void
  /** Open the goal panel for an Activity. */
  onOpenGoals: (activityId: string) => void
  /** Open the rename form for an Activity. */
  onRename: (activityId: string) => void
  /** Request deletion of an Activity (parent shows the confirm dialog). */
  onDelete: (activityId: string) => void
}

/**
 * Render the Activity list from the store snapshot, or the empty state. Owns the
 * single open quick-entry row; everything else is derived or delegated.
 */
export function ActivityList({
  onCreateActivity,
  onOpenChart,
  onOpenGoals,
  onRename,
  onDelete,
}: ActivityListProps): ReactElement {
  const snapshot = useTrackerSnapshot()
  const numberDisplay = useNumberDisplay()
  const { recordValue } = useTrackerActions()

  // The id of the one Activity whose quick-entry sheet is open, or null.
  const [openQuickEntryId, setOpenQuickEntryId] = useState<string | null>(null)

  // The list screen is only rendered when the Tracker is ready (App gates on
  // the loading phase); fall back to an empty Dataset defensively so this
  // component never throws if rendered early.
  const dataset = snapshot.load.phase === 'ready' ? snapshot.load.dataset : null
  const rows = dataset === null ? [] : activityListModel(dataset, snapshot.today, numberDisplay)

  if (rows.length === 0) {
    return (
      <section className="activity-list activity-list-empty" aria-label="Activities">
        <p className="activity-list-empty-message">
          You have no activities yet. Create one to start tracking.
        </p>
        <button type="button" className="activity-list-create" onClick={onCreateActivity}>
          Create activity
        </button>
      </section>
    )
  }

  return (
    <section className="activity-list" aria-label="Activities">
      <div className="activity-list-header">
        <button type="button" className="activity-list-create" onClick={onCreateActivity}>
          Create activity
        </button>
      </div>
      <ul className="activity-list-items">
        {rows.map((row) => (
          <ActivityRow
            key={row.id}
            row={row}
            today={snapshot.today}
            numberDisplay={numberDisplay}
            quickEntryOpen={openQuickEntryId === row.id}
            onOpenQuickEntry={setOpenQuickEntryId}
            onCloseQuickEntry={() => setOpenQuickEntryId(null)}
            onRecord={recordValue}
            onOpenChart={onOpenChart}
            onOpenGoals={onOpenGoals}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </section>
  )
}

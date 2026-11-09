/**
 * `ActivityRow` — one row of the Activity list (design: UI components —
 * `ActivityList` / `ActivityRow`, Req 2.3, 2.4, 2.5, 11.5, 11.6).
 *
 * A row renders the pre-computed `ActivityRowModel` from
 * `activityListModel(dataset, today, numberDisplay)` (viewModels.ts). All the
 * derivation — ordering, today's value or 0, which Goal types have an
 * Effective_Goal in their Current_Period, and the locale-formatted progress
 * text — happens in the pure view model, so this component only lays the data
 * out and wires interactions.
 *
 * It shows:
 * - the Activity name (Req 2.3),
 * - today's Daily_Value as a 44px button that opens inline `QuickEntry` under
 *   the row with the list still visible (Req 2.3, 11.5, 11.6),
 * - a progress/status badge per `GoalSummary` (weekly and/or monthly) — nothing
 *   for a Goal type without an Effective_Goal (Req 2.4),
 * - affordances to open the chart, goals, rename and delete views. The row does
 *   not own those dialogs/screens; it calls the callbacks the parent passes,
 *   and `App` (task 12.12) performs the state-based navigation and renders the
 *   actual `ChartView`, `GoalPanel`, `RenameForm` and delete `ConfirmDialog`.
 *
 * Number display: today's value uses the `NumberDisplay` from `useNumberDisplay`
 * so it follows the Device_Locale (Req 11.12); the progress text is already
 * locale-formatted inside the `GoalSummary` (`progressText`). All touch sizing
 * comes from CSS classes (44px targets); no inline styles (CSP).
 */

import type { ReactElement } from 'react'

import type { ActivityRowModel, GoalSummary } from '../domain/viewModels'
import type { LocalDate } from '../domain/calendar'
import type { NumberDisplay } from '../domain/numberFormat'
import type { CommandResult } from '../state/TrackerStore'
import { QuickEntry } from './QuickEntry'

/** Props for {@link ActivityRow}. */
export interface ActivityRowProps {
  /** The pre-derived row model for this Activity (viewModels.ts). */
  row: ActivityRowModel
  /** Today's Day, passed through to `QuickEntry` for the recorded Day. */
  today: LocalDate
  /** Locale-aware formatter for Read_Only_Numbers (today's value). */
  numberDisplay: NumberDisplay
  /** Whether this row's inline quick-entry sheet is open (owned by the parent). */
  quickEntryOpen: boolean
  /** Open this row's quick-entry sheet (tapping today's value). */
  onOpenQuickEntry: (activityId: string) => void
  /** Close this row's quick-entry sheet. */
  onCloseQuickEntry: () => void
  /** Record today's value (wired to the `recordValue` action). */
  onRecord: (activityId: string, date: LocalDate, value: string) => Promise<CommandResult>
  /** Open the chart view for this Activity. */
  onOpenChart: (activityId: string) => void
  /** Open the goal panel for this Activity. */
  onOpenGoals: (activityId: string) => void
  /** Open the rename form for this Activity. */
  onRename: (activityId: string) => void
  /** Request deletion of this Activity (parent shows the confirm dialog). */
  onDelete: (activityId: string) => void
}

/** A single Activity list item with today's value, goal badges and actions. */
export function ActivityRow({
  row,
  today,
  numberDisplay,
  quickEntryOpen,
  onOpenQuickEntry,
  onCloseQuickEntry,
  onRecord,
  onOpenChart,
  onOpenGoals,
  onRename,
  onDelete,
}: ActivityRowProps): ReactElement {
  return (
    <li className="activity-row">
      <div className="activity-row-main">
        <span className="activity-row-name">{row.name}</span>

        <button
          type="button"
          className="activity-row-today"
          aria-label={`Today's value for ${row.name}: ${numberDisplay.value(row.todayValue)}. Tap to record.`}
          aria-expanded={quickEntryOpen}
          onClick={() => onOpenQuickEntry(row.id)}
        >
          {numberDisplay.value(row.todayValue)}
        </button>

        {row.goals.length > 0 ? (
          <ul className="activity-row-goals">
            {row.goals.map((goal) => (
              <GoalBadge key={goal.goalType} goal={goal} />
            ))}
          </ul>
        ) : null}

        <div className="activity-row-actions">
          <button
            type="button"
            className="activity-row-action"
            onClick={() => onOpenChart(row.id)}
          >
            Chart
          </button>
          <button
            type="button"
            className="activity-row-action"
            onClick={() => onOpenGoals(row.id)}
          >
            Goals
          </button>
          <button
            type="button"
            className="activity-row-action"
            onClick={() => onRename(row.id)}
          >
            Rename
          </button>
          <button
            type="button"
            className="activity-row-action activity-row-delete"
            onClick={() => onDelete(row.id)}
          >
            Delete
          </button>
        </div>
      </div>

      {quickEntryOpen ? (
        <QuickEntry
          activityId={row.id}
          activityName={row.name}
          today={today}
          todayValue={row.todayValue}
          onRecord={onRecord}
          onClose={onCloseQuickEntry}
        />
      ) : null}
    </li>
  )
}

/** Props for {@link GoalBadge}. */
interface GoalBadgeProps {
  goal: GoalSummary
}

/**
 * One Goal type's Current_Period progress and status badge (Req 2.4, 7.5). The
 * `progressText` is already locale-formatted in the `GoalSummary`; the status
 * ("Achieved" / "In progress" / "Not achieved") comes straight from the model.
 */
function GoalBadge({ goal }: GoalBadgeProps): ReactElement {
  const typeLabel = goal.goalType === 'weekly' ? 'Weekly' : 'Monthly'
  return (
    <li className="activity-row-goal">
      <span className="activity-row-goal-type">{typeLabel}</span>
      <span className="activity-row-goal-progress">{goal.progressText}</span>
      <span className="activity-row-goal-status">{goal.status}</span>
    </li>
  )
}

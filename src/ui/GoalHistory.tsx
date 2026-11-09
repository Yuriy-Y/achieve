/**
 * `GoalHistory` — the newest-first list of Goal_Versions for one Activity
 * (design: UI components — `GoalPanel / GoalHistory`, Req 8.11, 8.12).
 *
 * The Goal history is a pure projection of the Activity's Goal_Versions: the
 * ordering (newest first, weekly before monthly on a tie) is decided in the
 * domain by `goalHistory(goalVersions, activityId)`, so this component only
 * reads that ordered list and renders one entry per Goal_Version. The entries
 * come straight from the current snapshot's `Dataset`, so a committed set,
 * change or removal re-renders the history within the same frame (Req 2.7).
 *
 * Each entry states (Req 8.11):
 *   - the Goal type ("Weekly" / "Monthly"),
 *   - the change: the set value (formatted in the Device_Locale via the shared
 *     `NumberDisplay`, Req 11.12) or the word "Removed" for a removal
 *     Goal_Version,
 *   - the start Period: the first Day from which the version applies, derived
 *     from the version's `startPeriod` key with `periodStart` and formatted
 *     with a fixed `Intl.DateTimeFormat('en-GB')` so Period labels do not vary
 *     with the Device_Locale (matching the chart titles in `viewModels.ts`).
 *
 * When the Activity has no Goal_Versions the history shows an empty-state
 * message (Req 8.12).
 *
 * All sizing and spacing come from CSS classes (task-14 stylesheet); no inline
 * styles are used (CSP `style-src 'self'`).
 */

import type { ReactElement } from 'react'

import type { GoalType, Period } from '../domain/calendar'
import { periodStart } from '../domain/calendar'
import type { GoalVersion } from '../domain/dataset'
import { goalHistory } from '../domain/goals'
import type { NumberDisplay } from '../domain/numberFormat'

/** Props for {@link GoalHistory}. */
export interface GoalHistoryProps {
  /** Every Goal_Version in the Data_Set (from the current snapshot). */
  goalVersions: readonly GoalVersion[]
  /** The Activity whose Goal history is shown. */
  activityId: string
  /** Locale formatter for the set values (Req 11.12). */
  fmt: NumberDisplay
}

/**
 * Renders the Activity's Goal history newest first, or an empty-state message
 * when the Activity has no Goal_Versions.
 */
export function GoalHistory({ goalVersions, activityId, fmt }: GoalHistoryProps): ReactElement {
  const history = goalHistory(goalVersions, activityId)

  if (history.length === 0) {
    return (
      <section className="goal-history" aria-label="Goal history">
        <h3 className="goal-history-title">Goal history</h3>
        <p className="goal-history-empty">No goals have been set for this activity yet.</p>
      </section>
    )
  }

  return (
    <section className="goal-history" aria-label="Goal history">
      <h3 className="goal-history-title">Goal history</h3>
      <ol className="goal-history-list">
        {history.map((version) => (
          <li
            key={`${version.goalType}-${version.startPeriod}`}
            className="goal-history-entry"
          >
            <span className="goal-history-type">{goalTypeLabel(version.goalType)}</span>
            <span className="goal-history-change">{changeLabel(version, fmt)}</span>
            <span className="goal-history-start">
              from {startPeriodLabel({ type: version.goalType, key: version.startPeriod })}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Human-readable Goal type label. */
function goalTypeLabel(type: GoalType): string {
  return type === 'weekly' ? 'Weekly' : 'Monthly'
}

/** The change an entry records: the set value, or "Removed" for a removal. */
function changeLabel(version: GoalVersion, fmt: NumberDisplay): string {
  return version.kind === 'set' ? `Set to ${fmt.value(version.value)}` : 'Removed'
}

// Fixed en-GB formatter for Period start labels (design specifies en-GB for
// Period labels, as in viewModels.ts). Weekly versions show the start Day;
// monthly versions show the month and year.
const WEEK_START_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const MONTH_START_FORMAT = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/** A `LocalDate` as a UTC `Date` for the fixed en-GB formatters (no TZ drift). */
function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

/**
 * Label for the start Period of a Goal_Version. A weekly version labels the
 * first Day of its start Week ("Mon 9 Feb 2026"); a monthly version labels the
 * month and year ("February 2026").
 */
function startPeriodLabel(period: Period): string {
  const start = toUtcDate(periodStart(period))
  return period.type === 'weekly'
    ? WEEK_START_FORMAT.format(start)
    : MONTH_START_FORMAT.format(start)
}

/**
 * `PeriodSummary` — the numeric summary shown next to the chart for the
 * selected Period (design: UI components — `PeriodSummary`, Req 5.7, 5.8, 6.9,
 * 7.1, 7.5, 8.9, 8.10, 11.12, 11.13).
 *
 * It is a pure presenter of a `ChartModel`: it renders no domain logic of its
 * own. Every number comes pre-derived from the model — the Period_Total as a
 * `Milli`, and, when a Goal applies, the `GoalSummary` with its Effective_Goal
 * value, Goal_Progress (as display text already formatted in the Device_Locale)
 * and Goal_Status.
 *
 * Three mutually exclusive cases follow the requirements:
 * - A Goal of the view type applies (`model.goal !== null`): show the
 *   Period_Total, the Effective_Goal value, the Goal_Progress and the
 *   Goal_Status (Req 5.7, 7.1, 7.5).
 * - No Goal applies and the Period is in the past (`model.pastNoGoalText ===
 *   'no goal applied'`): show the Period_Total and the "no goal applied" text
 *   (Req 8.10).
 * - No Goal applies otherwise (Current_Period or future with no Goal): show
 *   only the Period_Total (Req 5.8, 6.9).
 *
 * Read_Only_Numbers (the Period_Total and the Effective_Goal value) are
 * formatted through the shared `NumberDisplay` so they follow the
 * Device_Locale's separators and grouping (Req 11.12); the Goal_Progress text
 * in the `GoalSummary` is likewise already locale-formatted with one decimal
 * place and a percent sign (Req 7.1, 11.13). All sizing comes from CSS classes;
 * no inline styles (CSP `style-src 'self'`).
 */

import type { ReactElement } from 'react'

import type { NumberDisplay } from '../domain/numberFormat'
import type { ChartModel } from '../domain/viewModels'

/** Props for {@link PeriodSummary}. */
export interface PeriodSummaryProps {
  /** The chart model for the selected Activity and Period. */
  model: ChartModel
  /** Locale-aware formatter for the Period_Total and Goal value (Req 11.12). */
  fmt: NumberDisplay
}

/**
 * The Period_Total and, when an Effective_Goal of the view type applies, the
 * goal value, Goal_Progress and Goal_Status; otherwise just the total, with
 * "no goal applied" for a past Period (Req 5.7, 5.8, 8.10).
 */
export function PeriodSummary({ model, fmt }: PeriodSummaryProps): ReactElement {
  const { total, goal, pastNoGoalText } = model

  return (
    <dl className="period-summary">
      <div className="period-summary-row">
        <dt className="period-summary-label">Total</dt>
        <dd className="period-summary-total">{fmt.value(total)}</dd>
      </div>

      {goal !== null ? (
        <>
          <div className="period-summary-row">
            <dt className="period-summary-label">Goal</dt>
            <dd className="period-summary-goal">{fmt.value(goal.goal)}</dd>
          </div>
          <div className="period-summary-row">
            <dt className="period-summary-label">Progress</dt>
            <dd className="period-summary-progress">{goal.progressText}</dd>
          </div>
          <div className="period-summary-row">
            <dt className="period-summary-label">Status</dt>
            <dd className="period-summary-status">{goal.status}</dd>
          </div>
        </>
      ) : pastNoGoalText !== null ? (
        <div className="period-summary-row">
          <dt className="period-summary-label">Goal</dt>
          <dd className="period-summary-no-goal">{pastNoGoalText}</dd>
        </div>
      ) : null}
    </dl>
  )
}

/**
 * `ChartView` — the per-Activity chart screen (design: UI components —
 * `ChartView` / `PeriodNavigator`, and the Overview's chart section, Req
 * 5.1-5.11, 8.9, 8.10, 12.22).
 *
 * This screen ties together the pure chart view model and the presentation
 * pieces built in earlier tasks. It owns only the view state — the selected
 * view type (weekly/monthly) and the selected Period — and derives everything
 * else from the domain:
 *
 * - On open it defaults to the current Week (`currentPeriod(today, 'weekly')`),
 *   so the chart shows the Week that is the Current_Period (Req 5.4).
 * - The `ChartModel` is built with `chartModel(dataset, activityId, period,
 *   today, fmt)`; it carries the positions, future marking, aria labels, title,
 *   goal summary, `pastNoGoalText` and `canGoNext` (Req 5.1-5.3, 5.6-5.10, 8.9,
 *   8.10, 12.22). No domain logic is recomputed here.
 * - `PeriodNavigator` renders the title and prev/next; `navigate(period, dir,
 *   today)` produces the adjacent Period and the view model's `canGoNext` keeps
 *   future Periods unreachable (Req 5.5, 5.10).
 * - The weekly/monthly toggle calls `switchViewType(selected, newType, today)`,
 *   which keeps the user near the same point in time (Req 5.11).
 * - `BarChart` draws the Period from the same model (Req 5.1-5.3, 5.6, 5.9);
 *   `PeriodSummary` shows the Period_Total and, when present, the Effective_Goal,
 *   Goal_Progress and Goal_Status, or "no goal applied" for a past Period
 *   (Req 5.7, 5.8, 8.10).
 * - A Day list under the chart lets the user open `ValueEntry` for a specific
 *   Day of the selected Period. Days after today are shown but not editable:
 *   their buttons are disabled, so the future-date gate holds (Req 3.5, 4.6,
 *   12.22, 12.23). `ValueEntry` is opened with a fixed `date`, so it records
 *   against exactly that Day and reuses its own future guard as a backstop.
 *
 * Data comes from the store: the `Dataset` and `today` from the active snapshot
 * (`useTrackerSnapshot`), the recording action from `useTrackerActions` (via
 * `ValueEntry`), and the Device_Locale formatter from `useNumberDisplay`. All
 * sizing (44px touch targets) is class-only; no inline styles (CSP
 * `style-src 'self'`).
 */

import { useState } from 'react'
import type { ReactElement } from 'react'

import type { GoalType, LocalDate } from '../domain/calendar'
import { compareDates, currentPeriod, daysOf } from '../domain/calendar'
import type { Dataset } from '../domain/dataset'
import type { Milli } from '../domain/decimal'
import { chartModel, navigate, switchViewType } from '../domain/viewModels'
import { useNumberDisplay } from '../state/useNumberDisplay'
import { useTrackerSnapshot } from '../state/useTracker'
import { BarChart } from './BarChart'
import { PeriodNavigator } from './PeriodNavigator'
import { PeriodSummary } from './PeriodSummary'
import { ValueEntry } from './ValueEntry'

/** Props for {@link ChartView}. */
export interface ChartViewProps {
  /** The Activity whose chart is shown. */
  activityId: string
  /** The Activity name, used to label the chart region accessibly. */
  activityName: string
  /** Close the chart screen and return to the list (parent navigation). */
  onClose?: () => void
}

/** The two view types in a fixed order (weekly before monthly). */
const VIEW_TYPES: readonly GoalType[] = ['weekly', 'monthly']

/**
 * The per-Activity chart screen. Holds the selected view type and Period; reads
 * the Dataset and `today` from the store snapshot; delegates all derivation to
 * the pure `chartModel`, `navigate` and `switchViewType`.
 */
export function ChartView({ activityId, activityName, onClose }: ChartViewProps): ReactElement {
  const snapshot = useTrackerSnapshot()
  const fmt = useNumberDisplay()

  // The chart is only reachable once data has loaded; fall back defensively to
  // an empty Dataset and the snapshot's `today` if rendered during loading.
  const dataset: Dataset =
    snapshot.load.phase === 'ready'
      ? snapshot.load.dataset
      : { activities: [], values: new Map(), goalVersions: [] }
  const today = snapshot.today

  // Selected view type and Period; default to the current Week (Req 5.4).
  const [viewType, setViewType] = useState<GoalType>('weekly')
  const [period, setPeriod] = useState(() => currentPeriod(today, 'weekly'))
  // The Day currently open for recording, or null when the entry is closed.
  const [entryDate, setEntryDate] = useState<LocalDate | null>(null)

  const model = chartModel(dataset, activityId, period, today, fmt)

  const handleNavigate = (dir: 'prev' | 'next'): void => {
    setPeriod(navigate(period, dir, today))
    setEntryDate(null)
  }

  const handleSwitchType = (newType: GoalType): void => {
    if (newType === viewType) return
    setViewType(newType)
    setPeriod(switchViewType(period, newType, today))
    setEntryDate(null)
  }

  const days = daysOf(period)
  const activityValues = dataset.values.get(activityId)
  const currentEntryValue: Milli =
    entryDate !== null ? activityValues?.get(entryDate) ?? 0 : 0

  return (
    <section className="chart-view" aria-label={`Chart for ${activityName}`}>
      <div className="chart-view-header">
        <h1 className="chart-view-title">{activityName}</h1>
        {onClose === undefined ? null : (
          <button type="button" className="chart-view-close" onClick={onClose}>
            Back
          </button>
        )}
      </div>

      <div
        className="chart-view-type-toggle"
        role="group"
        aria-label="Chart view type"
      >
        {VIEW_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className="chart-view-type-button"
            aria-pressed={viewType === type}
            onClick={() => handleSwitchType(type)}
          >
            {type === 'weekly' ? 'Weekly' : 'Monthly'}
          </button>
        ))}
      </div>

      <PeriodNavigator
        title={model.title}
        viewType={viewType}
        canGoNext={model.canGoNext}
        onNavigate={handleNavigate}
      />

      <BarChart model={model} />

      <PeriodSummary model={model} fmt={fmt} />

      <div className="chart-view-days">
        <h2 className="chart-view-days-title">Record a value</h2>
        <ul className="chart-view-day-list">
          {days.map((date) => {
            const isFuture = compareDates(date, today) > 0
            const isOpen = entryDate === date
            return (
              <li key={date} className="chart-view-day">
                <button
                  type="button"
                  className="chart-view-day-button"
                  aria-expanded={isOpen}
                  disabled={isFuture}
                  onClick={() => setEntryDate(isOpen ? null : date)}
                >
                  {date}
                </button>
                {isOpen ? (
                  <ValueEntry
                    activityId={activityId}
                    today={today}
                    date={date}
                    currentValue={currentEntryValue}
                    onSaved={() => setEntryDate(null)}
                    onCancel={() => setEntryDate(null)}
                    autoFocus
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

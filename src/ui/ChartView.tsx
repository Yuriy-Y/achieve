/**
 * `ChartView` — the per-Activity chart screen (Req 5, 13.5, 15).
 *
 * The user picks a Granularity (Day, Week or Month) and, for Day, a Span (Week
 * or Month). The default is what the previous version showed: Day granularity
 * with the current Week (Req 15.5, 17.5). Navigation moves the window by its own
 * length and stops at the Current_Period (Req 15.6, 15.7).
 *
 * All derivation is done by the pure `granularity.ts` and `viewModels.ts`
 * functions. Day granularity keeps the Period summary (total, goal, progress,
 * status) of the shown Week or Month; Week and Month granularity show the
 * window sum and mark each position's own goal (Req 15.9, 15.10). Charts always
 * show raw Daily_Values, never tag ratios (Req 16.10).
 *
 * Recording: Day granularity lists the days of the window; each opens the
 * `EntryEditor` for that Day. For Week and Month granularity one `EntryEditor`
 * with a date field is shown. The editor lists the Day's entries and lets the
 * user add entries with tags (Req 14).
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import { compareDates, periodOf } from '../domain/calendar'
import type { LocalDate } from '../domain/calendar'
import { emptyDataset, type Dataset } from '../domain/dataset'
import {
  canGoNext,
  chartWindow,
  defaultWindow,
  shiftWindow,
  switchGranularity,
  switchSpan,
  type Granularity,
  type Span,
  type WindowSpec,
} from '../domain/granularity'
import { chartModel, chartModelV2 } from '../domain/viewModels'
import { useNumberDisplay } from '../state/useNumberDisplay'
import { useTrackerSnapshot } from '../state/useTracker'
import { BarChart } from './BarChart'
import { EntryEditor } from './EntryEditor'
import { GranularityControl } from './GranularityControl'
import { PeriodNavigator } from './PeriodNavigator'
import { PeriodSummary } from './PeriodSummary'

export interface ChartViewProps {
  activityId: string
  activityName: string
  onClose?: () => void
}

/** What one navigation step moves by, for the button labels. */
function stepUnit(spec: WindowSpec): string {
  if (spec.granularity === 'day') return spec.span
  return spec.granularity === 'week' ? '12 weeks' : '12 months'
}

export function ChartView({ activityId, activityName, onClose }: ChartViewProps): ReactElement {
  const snapshot = useTrackerSnapshot()
  const fmt = useNumberDisplay()
  const dataset: Dataset = snapshot.load.phase === 'ready' ? snapshot.load.dataset : emptyDataset()
  const today = snapshot.today

  const [spec, setSpec] = useState<WindowSpec>(() => defaultWindow(today))
  const [entryDate, setEntryDate] = useState<LocalDate | null>(null)

  const model = chartModelV2(dataset, activityId, activityName, spec, today, fmt)
  const days = spec.granularity === 'day' ? chartWindow(spec, today).map((b) => b.start) : []

  const update = (next: WindowSpec): void => {
    setSpec(next)
    setEntryDate(null)
  }

  // Day granularity keeps the Period summary of the shown Week or Month.
  const periodType = spec.span === 'week' ? 'weekly' : 'monthly'
  const dayModel =
    spec.granularity === 'day'
      ? chartModel(dataset, activityId, periodOf(spec.anchor, periodType), today, fmt)
      : null

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
      <GranularityControl
        granularity={spec.granularity}
        span={spec.span}
        onGranularity={(g: Granularity) => update(switchGranularity(spec, g, today))}
        onSpan={(s: Span) => update(switchSpan(spec, s, today))}
      />
      <PeriodNavigator
        title={model.title}
        unit={stepUnit(spec)}
        canGoNext={canGoNext(spec, today)}
        onNavigate={(dir) => update(shiftWindow(spec, dir, today))}
      />
      <BarChart model={model} />
      {dayModel !== null ? (
        <PeriodSummary model={dayModel} fmt={fmt} />
      ) : (
        <dl className="period-summary">
          <div className="period-summary-row">
            <dt className="period-summary-label">Total</dt>
            <dd className="period-summary-total">{model.windowTotalText}</dd>
          </div>
        </dl>
      )}
      <div className="chart-view-days">
        <h2 className="chart-view-days-title">Record a value</h2>
        {spec.granularity === 'day' ? (
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
                    <EntryEditor
                      activityId={activityId}
                      date={date}
                      onClose={() => setEntryDate(null)}
                      autoFocus
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <EntryEditor activityId={activityId} />
        )}
      </div>
    </section>
  )
}

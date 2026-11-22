/**
 * `AnalyserView` — the hidden analysis screen (Requirement 16).
 *
 * Reachable only after the reveal gesture on the app title. The user chooses
 * Activities and series (tags and "Not tagged"), a Granularity and window, and
 * optionally applies the global Tag_Ratios; the chart, legend and statistics
 * update from the pure `analyserModel`. The only data it can change is a
 * Tag_Ratio, through the `setTagRatio` command in `RatioPanel` (Req 16.20).
 * Choices of Activities or Tags that no longer exist are dropped.
 */
import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { analyserModel, defaultChoice, seriesTrend, type AnalyserChoice } from '../domain/analyser'
import { emptyDataset } from '../domain/dataset'
import {
  canGoNext,
  defaultWindow,
  shiftWindow,
  switchGranularity,
  switchSpan,
  type WindowSpec,
} from '../domain/granularity'
import { tagLibrary } from '../domain/tags'
import { analyserChartModel } from '../domain/viewModels'
import { useNumberDisplay } from '../state/useNumberDisplay'
import { useTrackerSnapshot } from '../state/useTracker'
import { AnalyserChooser } from './AnalyserChooser'
import { BarChart, type TrendLine } from './BarChart'
import { GranularityControl } from './GranularityControl'
import { PeriodNavigator } from './PeriodNavigator'
import { RatioPanel } from './RatioPanel'
import { SeriesLegend } from './SeriesLegend'
import { SeriesStats } from './SeriesStats'
import { statsRows } from './seriesStatsRows'

export interface AnalyserViewProps {
  onClose: () => void
  /** Hide the Analyser again (Req 16.1). */
  onHide: () => void
}

export function AnalyserView({ onClose, onHide }: AnalyserViewProps): ReactElement {
  const snapshot = useTrackerSnapshot()
  const fmt = useNumberDisplay()
  const dataset = snapshot.load.phase === 'ready' ? snapshot.load.dataset : emptyDataset()
  const today = snapshot.today

  const [choice, setChoice] = useState<AnalyserChoice>(defaultChoice)
  const [spec, setSpec] = useState<WindowSpec>(() => defaultWindow(today))
  const [showTrend, setShowTrend] = useState(false)

  const library = useMemo(() => tagLibrary(dataset), [dataset])
  // Drop choices that no longer exist (deleted Activity, tag that left the library).
  const effective = useMemo<AnalyserChoice>(() => {
    const ids = new Set(dataset.activities.map((a) => a.id))
    const keys = new Set(library.map((t) => t.key))
    return {
      ...choice,
      activityIds: choice.activityIds.filter((id) => ids.has(id)),
      tagKeys: choice.tagKeys.filter((k) => keys.has(k)),
    }
  }, [choice, dataset.activities, library])

  const model = useMemo(
    () => analyserModel(dataset, effective, spec, today),
    [dataset, effective, spec, today],
  )
  const chart = analyserChartModel(model, spec, today, fmt)
  const unit = spec.granularity === 'day' ? spec.span : spec.granularity === 'week' ? '12 weeks' : '12 months'
  // What one position is, for the trend wording ("per day", "per week", "per month").
  const positionUnit = spec.granularity
  const trends = showTrend ? model.series.map((r) => seriesTrend(r.values, model.buckets, today)) : undefined
  const trendLines: (TrendLine | null)[] | undefined = trends?.map((t) =>
    t === null ? null : { fromIndex: 0, fromValue: t.startValue, toIndex: t.lastIndex, toValue: t.endValue },
  )

  return (
    <section className="analyser" aria-label="Analyser">
      <div className="chart-view-header">
        <h1 className="chart-view-title">Analyser</h1>
        <button type="button" className="chart-view-close" onClick={onClose}>
          Back
        </button>
      </div>

      {dataset.activities.length === 0 ? (
        <p className="analyser-empty">Create an activity to analyse your values.</p>
      ) : (
        <>
          <AnalyserChooser
            activities={dataset.activities}
            library={library}
            choice={effective}
            onChange={setChoice}
          />
          <RatioPanel
            dataset={dataset}
            applyRatios={effective.applyRatios}
            onApplyRatios={(applyRatios) => setChoice((c) => ({ ...c, applyRatios }))}
          />
          <GranularityControl
            granularity={spec.granularity}
            span={spec.span}
            onGranularity={(g) => setSpec(switchGranularity(spec, g, today))}
            onSpan={(s) => setSpec(switchSpan(spec, s, today))}
          />
          <PeriodNavigator
            title={chart.title}
            unit={unit}
            canGoNext={canGoNext(spec, today)}
            onNavigate={(dir) => setSpec(shiftWindow(spec, dir, today))}
          />
          <p className="analyser-caption" role="status">
            {model.ratiosApplied ? 'Tag ratios applied' : 'Tag ratios not applied'}
          </p>
          <button
            type="button"
            className="analyser-trend-toggle"
            aria-pressed={showTrend}
            onClick={() => setShowTrend((on) => !on)}
          >
            Trend
          </button>
          <BarChart model={chart} trends={trendLines} />
          <SeriesLegend series={chart.series} />
          {model.series.map((r) =>
            r.note === null ? null : (
              <p key={r.spec.id} className="analyser-message">
                {r.note === 'noEntriesWithTag'
                  ? `No chosen activity has entries with the tag ${r.spec.label}.`
                  : 'No chosen activity has entries without tags.'}
              </p>
            ),
          )}
          <SeriesStats rows={statsRows(model, chart, fmt, trends, positionUnit)} />
          <p className="analyser-used">
            Activities used: {model.usedActivities.map((a) => a.name).join(', ')}
          </p>
        </>
      )}
      <button type="button" className="analyser-hide" onClick={onHide}>
        Hide Analyser
      </button>
    </section>
  )
}

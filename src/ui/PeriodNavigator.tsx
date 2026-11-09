/**
 * `PeriodNavigator` — the chart's title and previous/next Period controls
 * (design: UI components — `ChartView` / `PeriodNavigator`, Req 5.5, 5.10).
 *
 * This is a thin presenter over the `ChartModel`: it renders the model's
 * `title` (the Week range or the Month name, already formatted in the view
 * model) and two navigation buttons. The buttons do not compute the adjacent
 * Period themselves; they call the pure `navigate(period, 'prev'|'next',
 * today)` from `viewModels.ts` through the `onNavigate` callback so all calendar
 * logic stays in the domain layer (Req 5.5).
 *
 * The next button is disabled exactly when `model.canGoNext` is false, which
 * the view model sets for the Current_Period, so future Periods are never
 * reachable by navigation (Req 5.10). The previous button is always enabled.
 *
 * Accessibility: each button carries an explicit `aria-label` ("Previous
 * week/month", "Next week/month") so its purpose is clear to screen readers
 * independent of the icon/text glyph, and the title is a heading associated
 * with the chart region by the parent `ChartView`. All touch sizing (44px)
 * comes from CSS classes; no inline styles (CSP `style-src 'self'`).
 */

import type { ReactElement } from 'react'

import type { GoalType } from '../domain/calendar'

/** Props for {@link PeriodNavigator}. */
export interface PeriodNavigatorProps {
  /** The chart title for the selected Period (Week range or Month name). */
  title: string
  /** The selected view type, used to word the navigation labels. */
  viewType: GoalType
  /** Whether the next-Period button is enabled (false at the Current_Period, Req 5.10). */
  canGoNext: boolean
  /** Move to the adjacent Period; wired to `navigate(period, dir, today)`. */
  onNavigate: (dir: 'prev' | 'next') => void
}

/**
 * The title plus previous/next navigation for the chart's selected Period. Pure
 * presenter: it renders model-derived props and delegates the actual Period
 * arithmetic to the caller's `onNavigate`.
 */
export function PeriodNavigator({
  title,
  viewType,
  canGoNext,
  onNavigate,
}: PeriodNavigatorProps): ReactElement {
  const unit = viewType === 'weekly' ? 'week' : 'month'

  return (
    <div className="period-navigator">
      <button
        type="button"
        className="period-navigator-prev"
        aria-label={`Previous ${unit}`}
        onClick={() => onNavigate('prev')}
      >
        <span aria-hidden="true">{'\u2039'}</span>
      </button>
      <h2 className="period-navigator-title">{title}</h2>
      <button
        type="button"
        className="period-navigator-next"
        aria-label={`Next ${unit}`}
        disabled={!canGoNext}
        onClick={() => onNavigate('next')}
      >
        <span aria-hidden="true">{'\u203a'}</span>
      </button>
    </div>
  )
}

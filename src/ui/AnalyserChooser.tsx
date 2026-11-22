/**
 * `AnalyserChooser` — choice of Activities and series (Req 16.3).
 *
 * Activities are checkboxes ("Clear" = none chosen = all Activities are used,
 * Req 16.4). Series are toggle chips: a "Not tagged" chip plus every Tag of the
 * Tag_Library (with its number of entries). At most 6 series can be compared;
 * choosing a seventh shows a message and changes nothing.
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import { ANALYSER_SERIES_MAX, type AnalyserChoice } from '../domain/analyser'
import type { Activity } from '../domain/dataset'
import type { TagLibraryEntry } from '../domain/tags'

export interface AnalyserChooserProps {
  activities: readonly Activity[]
  library: readonly TagLibraryEntry[]
  choice: AnalyserChoice
  /** Receives an updater so quick successive toggles never overwrite each other. */
  onChange: (update: (previous: AnalyserChoice) => AnalyserChoice) => void
}

export const TOO_MANY_SERIES_MESSAGE = 'At most 6 series (tags and "Not tagged") can be compared.'

export function AnalyserChooser({ activities, library, choice, onChange }: AnalyserChooserProps): ReactElement {
  const [message, setMessage] = useState<string | null>(null)
  const chosenActivities = new Set(choice.activityIds)
  const seriesCount = choice.tagKeys.length + (choice.includeUntagged ? 1 : 0)

  const toggleActivity = (id: string): void => {
    onChange((c) => {
      const next = new Set(c.activityIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...c, activityIds: [...next] }
    })
  }

  const toggleSeries = (kind: 'tag' | 'untagged', key: string): void => {
    const on = kind === 'untagged' ? choice.includeUntagged : choice.tagKeys.includes(key)
    if (!on && seriesCount >= ANALYSER_SERIES_MAX) {
      setMessage(TOO_MANY_SERIES_MESSAGE)
      return
    }
    setMessage(null)
    if (kind === 'untagged') onChange((c) => ({ ...c, includeUntagged: !c.includeUntagged }))
    else {
      onChange((c) => ({
        ...c,
        tagKeys: c.tagKeys.includes(key) ? c.tagKeys.filter((k) => k !== key) : [...c.tagKeys, key],
      }))
    }
  }

  return (
    <div className="analyser-chooser">
      <fieldset className="analyser-fieldset">
        <legend className="analyser-legend">Activities (none chosen = all)</legend>
        <ul className="analyser-activity-list">
          {activities.map((a) => (
            <li key={a.id} className="analyser-activity">
              <label className="analyser-activity-label">
                <input
                  type="checkbox"
                  checked={chosenActivities.has(a.id)}
                  onChange={() => toggleActivity(a.id)}
                />
                <span>{a.name}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="analyser-chooser-actions">
          <button
            type="button"
            onClick={() => onChange((c) => ({ ...c, activityIds: activities.map((a) => a.id) }))}
          >
            Select all
          </button>
          <button type="button" onClick={() => onChange((c) => ({ ...c, activityIds: [] }))}>
            Clear
          </button>
        </div>
      </fieldset>
      <fieldset className="analyser-fieldset">
        <legend className="analyser-legend">Series to compare</legend>
        <div className="analyser-tags" role="group" aria-label="Tags">
          <button
            type="button"
            className="analyser-tag"
            aria-pressed={choice.includeUntagged}
            onClick={() => toggleSeries('untagged', 'untagged')}
          >
            Not tagged
          </button>
          {library.map((t) => (
            <button
              key={t.key}
              type="button"
              className="analyser-tag"
              aria-pressed={choice.tagKeys.includes(t.key)}
              onClick={() => toggleSeries('tag', t.key)}
            >
              {t.label} <span className="analyser-tag-count">({t.count})</span>
            </button>
          ))}
        </div>
        {message !== null ? (
          <p className="analyser-message" role="alert">
            {message}
          </p>
        ) : null}
      </fieldset>
    </div>
  )
}

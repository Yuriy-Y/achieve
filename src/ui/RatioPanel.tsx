/**
 * `RatioPanel` — "Apply tag ratios" and the global Tag_Ratios (Req 16.7-16.11).
 *
 * The switch is off by default; ratios only affect Analyser series while it is
 * on. Every Tag in the Tag_Library shows its ratio (1 when unassigned) with an
 * input (0.001 to 1,000, "." or "," as separator), Save and "Reset to 1". The
 * untagged combination is shown as a fixed "Not tagged: 1" row. A rejected or
 * unsaved change keeps the typed text and shows the message.
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import { formatMilli, RATIO_ONE } from '../domain/decimal'
import type { Dataset } from '../domain/dataset'
import { tagLibrary } from '../domain/tags'
import { useTrackerActions } from '../state/useTracker'
import { DecimalInput } from './DecimalInput'
import { COMMIT_FAILED_MESSAGE, RECOVERY_WRITE_MESSAGE, commandErrorMessage } from './messages'

export interface RatioPanelProps {
  dataset: Dataset
  applyRatios: boolean
  onApplyRatios: (apply: boolean) => void
}

export function RatioPanel({ dataset, applyRatios, onApplyRatios }: RatioPanelProps): ReactElement {
  const library = tagLibrary(dataset).sort((a, b) => a.label.localeCompare(b.label, 'en'))
  return (
    <section className="ratio-panel" aria-label="Tag ratios">
      <label className="ratio-switch">
        <input
          type="checkbox"
          checked={applyRatios}
          onChange={(event) => onApplyRatios(event.target.checked)}
        />
        <span>Apply tag ratios</span>
      </label>
      <p className="ratio-note">
        A ratio multiplies the values of entries that carry the tag, only in this analysis. Entries
        with several tags use the product of their ratios.
      </p>
      <ul className="ratio-list">
        <li className="ratio-row ratio-row-fixed">
          <span className="ratio-row-tag">Not tagged</span>
          <span className="ratio-row-fixed-value">1</span>
        </li>
        {library.map((tag) => (
          <RatioRow
            key={tag.key}
            label={tag.label}
            stored={dataset.tagRatios.get(tag.key)?.ratio ?? RATIO_ONE}
          />
        ))}
      </ul>
    </section>
  )
}

function RatioRow({ label, stored }: { label: string; stored: number }): ReactElement {
  const { setTagRatio } = useTrackerActions()
  const [text, setText] = useState(formatMilli(stored))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (value: string): Promise<void> => {
    setBusy(true)
    const result = await setTagRatio(label, value)
    setBusy(false)
    if (result.status === 'saved') {
      setError(null)
      return
    }
    if (result.status === 'rejected') setError(commandErrorMessage(result.error))
    else setError(result.reason === 'recovery' ? RECOVERY_WRITE_MESSAGE : COMMIT_FAILED_MESSAGE)
  }

  return (
    <li className="ratio-row">
      <span className="ratio-row-tag">{label}</span>
      <DecimalInput
        label={`Ratio for ${label}`}
        value={text}
        onChange={(next) => {
          setText(next)
          setError(null)
        }}
        error={error}
        disabled={busy}
      />
      <button
        type="button"
        className="ratio-row-save"
        disabled={busy}
        onClick={() => {
          void save(text)
        }}
      >
        Save
      </button>
      <button
        type="button"
        className="ratio-row-reset"
        disabled={busy || stored === RATIO_ONE}
        onClick={() => {
          setText('1')
          void save('1')
        }}
      >
        Reset to 1
      </button>
    </li>
  )
}

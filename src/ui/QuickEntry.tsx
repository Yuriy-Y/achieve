/**
 * `QuickEntry` — the fast "record today's value" control for one Activity row
 * (design: UI components — `QuickEntry`, Req 11.5, 11.6).
 *
 * Tapping today's Daily_Value in the Activity list opens this inline sheet
 * directly under the row; the Activity list stays rendered the whole time (Req
 * 11.5). It is intentionally a small inline form rather than the full
 * `ValueEntry` (task 12.4): quick entry only ever records *today's* value for a
 * single Activity, so it needs just one `DecimalInput` plus Save / Cancel.
 *
 * Input handling:
 * - The field is prefilled with the canonical form of today's stored value via
 *   `formatMilli` (no digit grouping, Req 11.14); a stored value therefore
 *   never re-parses differently when the user reopens quick entry.
 * - Parsing, range checking and persistence all live in the domain and store
 *   layers. On Save the raw text is handed to `recordValue` for today's Day;
 *   the component only inspects the `CommandResult` (design: Change flow).
 * - On `saved` the parent is told to close the sheet (Req 11.6: the updated
 *   value shows in the list). On `rejected` the field-level validation message
 *   is shown and the entered text is kept (Req 3.4, 3.8 wording "input kept").
 *   On `notSaved` (commit failure or recovery mode) the text is likewise kept;
 *   the store surfaces the persist/recovery message through the shared
 *   `Notifications` region, so this component keeps only the field error.
 *
 * All sizing (44px touch targets for the Save / Cancel buttons and the input)
 * comes from CSS classes in the task-14 stylesheet; no inline styles are used
 * (CSP `style-src 'self'`).
 */

import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'

import type { LocalDate } from '../domain/calendar'
import { formatMilli, type Milli } from '../domain/decimal'
import type { CommandResult } from '../state/TrackerStore'
import { commandErrorMessage } from './messages'
import { DecimalInput } from './DecimalInput'
import { BUTTON_LABELS } from './messages'

/** Props for {@link QuickEntry}. */
export interface QuickEntryProps {
  /** The Activity whose today value is being recorded. */
  activityId: string
  /** The Activity name, used to label the quick-entry field accessibly. */
  activityName: string
  /** Today's Day (`LocalDate`), the Day the recorded value is stored against. */
  today: LocalDate
  /** Today's stored Daily_Value in milli units (0 when none is stored, Req 2.3). */
  todayValue: Milli
  /**
   * Record today's value. Wired by the parent to the `recordValue` action of
   * `useTrackerActions`, already bound to `today`.
   */
  onRecord: (activityId: string, date: LocalDate, value: string) => Promise<CommandResult>
  /** Close the quick-entry sheet (on Save success or Cancel). */
  onClose: () => void
}

/**
 * Inline quick-entry form for today's Daily_Value of one Activity. Controlled
 * entirely by local input state; delegates parse/validate/persist to the store.
 */
export function QuickEntry({
  activityId,
  activityName,
  today,
  todayValue,
  onRecord,
  onClose,
}: QuickEntryProps): ReactElement {
  // Prefill with the canonical input form of the stored value (Req 11.14).
  const [text, setText] = useState(() => formatMilli(todayValue))
  const [error, setError] = useState<string | null>(null)

  const handleChange = (value: string): void => {
    setText(value)
    // Clear a stale validation message as soon as the user edits the field.
    if (error !== null) setError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const result = await onRecord(activityId, today, text)
    if (result.status === 'saved') {
      // The list now shows the updated value; close the sheet (Req 11.6).
      onClose()
      return
    }
    if (result.status === 'rejected') {
      // Show the field error and keep the entered text (Req 3.4).
      setError(commandErrorMessage(result.error))
      return
    }
    // notSaved: commit failure or recovery mode. Keep the input; the store's
    // notice drives the shared live-region message (Req 3.8, 9.14).
  }

  return (
    <form className="quick-entry" onSubmit={handleSubmit} aria-label={`Record today for ${activityName}`}>
      <DecimalInput
        label={`Today's value for ${activityName}`}
        value={text}
        onChange={handleChange}
        error={error}
        autoFocus
      />
      <div className="quick-entry-actions">
        <button type="button" className="quick-entry-cancel" onClick={onClose}>
          {BUTTON_LABELS.cancel}
        </button>
        <button type="submit" className="quick-entry-save">
          Save
        </button>
      </div>
    </form>
  )
}

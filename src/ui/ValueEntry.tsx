/**
 * `ValueEntry` — record or edit the Daily_Value of one Activity for one Day
 * (design: UI components — `ValueEntry`).
 *
 * This is the shared recording control used by the value editor and, through
 * `ActivityRow` / `QuickEntry` (task 12.2), by the Activity list, and by the
 * chart (task 12.6). It is deliberately small and self-contained: the caller
 * supplies which Activity and Day to record for and the Day's current stored
 * value; the component owns only the in-progress input text and the inline
 * error, and defers all parsing, validation and persistence to the domain and
 * state layers.
 *
 * Responsibilities, mapped to the requirements:
 *
 * - A `<input type="date" max={today}>` chooses the Day. Its `max` attribute
 *   stops the native picker from offering future Days (Req 3.6), and a code
 *   guard rejects a future Day independently of the browser, because `max` is
 *   advisory and a typed value can exceed it (Req 3.5, 4.6, 12.23). When the
 *   selected Day is after today the value field is disabled and the future
 *   message is shown, so a future Day can never be submitted.
 * - A `DecimalInput` captures the value. It accepts "." or "," as the decimal
 *   separator and requests a decimal keypad; the actual grammar/range check is
 *   `parseDailyValue` inside `applyCommand` (0..999,999.999, at most 3 dp,
 *   Req 3.4, 4.5). The field is prefilled with the canonical, locale-independent
 *   form of the current value via `formatMilli` (Req 11.14), so editing an
 *   existing value never re-parses differently.
 * - On submit the component calls `recordValue(activityId, date, text)`. A
 *   `rejected` result keeps the input and shows the field error from
 *   `messages.ts` through `aria-describedby` (value format/range, or date
 *   future) (Req 3.4, 4.5, 4.6); a `notSaved` result keeps the input and
 *   surfaces the shared "not saved" / recovery message (Req 3.8). A `saved`
 *   result — including a saved zero (Req 4.4) — confirms via `onSaved` so the
 *   caller can clear or close (Req 3.2, 3.3, 3.7, 4.1).
 *
 * Styling is class-only (no inline styles, CSP `style-src 'self'`); the submit
 * and cancel controls and the date field reuse the 44px touch sizing from the
 * task-14 stylesheet (Req 11.2). The error copy comes solely from `messages.ts`
 * so wording stays consistent with the rest of the UI.
 */

import { useId, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { compareDates } from '../domain/calendar'
import type { LocalDate } from '../domain/calendar'
import { formatMilli } from '../domain/decimal'
import type { Milli } from '../domain/decimal'
import { useTrackerActions } from '../state/useTracker'
import { DecimalInput } from './DecimalInput'
import {
  COMMIT_FAILED_MESSAGE,
  FUTURE_DATE_MESSAGE,
  RECOVERY_WRITE_MESSAGE,
  commandErrorMessage,
} from './messages'

/** Props for {@link ValueEntry}. */
export interface ValueEntryProps {
  /** The Activity whose Daily_Value is being recorded or edited. */
  activityId: string
  /**
   * Today's `LocalDate` (from the store), used as the date field's `max` and as
   * the future-date gate so Days after today cannot be recorded (Req 3.5, 4.6).
   */
  today: LocalDate
  /**
   * The Day to record for. When omitted the user picks the Day with the date
   * field, starting at `today`; when provided (e.g. quick entry fixes it to
   * today, or the editor opens on a specific Day) the date field is hidden and
   * that Day is used.
   */
  date?: LocalDate
  /**
   * The Day's current stored Daily_Value in milli, used to prefill the input in
   * canonical form (Req 11.14). Omit (or pass `0`) when no value is stored; 0
   * reads as an empty field so recording is not forced to start from "0".
   */
  currentValue?: Milli
  /** Called after a value (possibly zero) is recorded and committed (Req 3.2). */
  onSaved?: () => void
  /** Called when the user cancels; the caller closes the entry. */
  onCancel?: () => void
  /** Auto-focus the value field when mounted (e.g. inline quick entry). */
  autoFocus?: boolean
}

/**
 * Prefill text for the value field: the canonical form of a non-zero stored
 * value, or an empty string for a missing value or a stored zero so the field
 * starts clean.
 */
function initialValueText(currentValue: Milli | undefined): string {
  if (currentValue === undefined || currentValue === 0) return ''
  return formatMilli(currentValue)
}

/**
 * Record or edit a Daily_Value. Controlled input lives here; parsing, range
 * checks and persistence happen in `applyCommand` / the store via
 * `recordValue`.
 */
export function ValueEntry({
  activityId,
  today,
  date,
  currentValue,
  onSaved,
  onCancel,
  autoFocus = false,
}: ValueEntryProps): ReactElement {
  const { recordValue } = useTrackerActions()
  const fixedDate = date !== undefined
  const [selectedDate, setSelectedDate] = useState<LocalDate>(date ?? today)
  const [valueText, setValueText] = useState<string>(() => initialValueText(currentValue))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const dateFieldId = useId()
  // The chosen Day is in the future when it sorts after today (Req 3.5, 4.6).
  const isFutureDate = compareDates(selectedDate, today) > 0

  const handleDateChange = (event: FormEvent<HTMLInputElement>): void => {
    setSelectedDate(event.currentTarget.value)
    // Clear any stale value/future error when the Day changes.
    setError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return

    // UI future-date gate: never dispatch for a Day after today (Req 3.5, 4.6,
    // 12.23). The domain layer enforces this too; this keeps the message local.
    if (isFutureDate) {
      setError(FUTURE_DATE_MESSAGE)
      return
    }

    setSubmitting(true)
    const result = await recordValue(activityId, selectedDate, valueText)
    setSubmitting(false)

    if (result.status === 'saved') {
      setError(null)
      onSaved?.()
      return
    }
    if (result.status === 'rejected') {
      // Keep the input and show the field error (value or date) (Req 3.4, 4.5).
      setError(commandErrorMessage(result.error))
      return
    }
    // notSaved: commit failure or a write refused in recovery mode (Req 3.8).
    setError(
      result.reason === 'recovery' ? RECOVERY_WRITE_MESSAGE : COMMIT_FAILED_MESSAGE,
    )
  }

  return (
    <form className="value-entry" onSubmit={handleSubmit} noValidate>
      {fixedDate ? null : (
        <div className="value-entry-date">
          <label className="value-entry-date-label" htmlFor={dateFieldId}>
            Day
          </label>
          <input
            id={dateFieldId}
            className="value-entry-date-field"
            type="date"
            max={today}
            value={selectedDate}
            onChange={handleDateChange}
          />
        </div>
      )}

      <DecimalInput
        label="Value"
        value={valueText}
        onChange={(next) => {
          setValueText(next)
          setError(null)
        }}
        error={error}
        disabled={isFutureDate || submitting}
        autoFocus={autoFocus}
      />

      <div className="value-entry-actions">
        <button
          type="submit"
          className="value-entry-save"
          disabled={isFutureDate || submitting}
        >
          Save
        </button>
        {onCancel === undefined ? null : (
          <button
            type="button"
            className="value-entry-cancel"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

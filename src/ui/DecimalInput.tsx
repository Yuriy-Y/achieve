/**
 * `DecimalInput` — the shared numeric-entry field for Daily_Values and Goal
 * values (design: UI components — `DecimalInput`).
 *
 * Both the quick entry, the value editor and the goal forms reuse this one
 * control so the keyboard, accepted characters and error wiring are identical
 * everywhere (Req 11.3, 11.4, 11.14):
 *
 * - `type="text"` with `inputMode="decimal"` requests a decimal numeric keypad
 *   on touch devices without forcing the browser's native number validation,
 *   which would reject a "," decimal separator (Req 11.3). Parsing and range
 *   checking stay in the domain layer (`parseDailyValue` / `parseGoalValue`),
 *   which accept both "." and "," (Req 11.4).
 * - `enterKeyHint="done"` labels the on-screen keyboard's action key, and
 *   `autoComplete="off"` keeps the browser from suggesting unrelated values.
 * - The field holds the canonical input text (prefilled by the parent with
 *   `formatMilli`, no digit grouping, Req 11.14); this component is a
 *   controlled input and never formats or parses itself.
 * - A validation message is linked to the input through `aria-describedby`, and
 *   `aria-invalid` is set while an error is shown, so assistive technology
 *   announces the error for the focused field (design: Error Handling —
 *   "message linked to the field via aria-describedby").
 *
 * The visible `<label>` is associated by `htmlFor`, and the control carries the
 * `decimal-input` class for the 44px touch sizing from the task-14 stylesheet;
 * no inline styles are used (CSP `style-src 'self'`).
 */

import { useId } from 'react'
import type { ChangeEvent, ReactElement } from 'react'

/** Props for {@link DecimalInput}. */
export interface DecimalInputProps {
  /** Visible label text associated with the input. */
  label: string
  /** The current input text (canonical form, usually from `formatMilli`). */
  value: string
  /** Called with the new raw text on every change; the parent keeps the state. */
  onChange: (value: string) => void
  /**
   * The validation message to show, or `null` when the field is valid. When
   * present it is rendered below the input and linked via `aria-describedby`,
   * and `aria-invalid` is set.
   */
  error?: string | null
  /** Optional explicit id for the input (defaults to a generated id). */
  id?: string
  /** Optional placeholder shown when the field is empty. */
  placeholder?: string
  /** Disable the control (e.g. while a future Day is selected). */
  disabled?: boolean
  /** Whether the field is auto-focused when mounted (e.g. in quick entry). */
  autoFocus?: boolean
}

/**
 * A controlled decimal text input with a label, decimal keypad hint and an
 * accessible error message. All parsing, formatting and validation live in the
 * parent and the domain layer; this component only renders and reports input.
 */
export function DecimalInput({
  label,
  value,
  onChange,
  error = null,
  id,
  placeholder,
  disabled = false,
  autoFocus = false,
}: DecimalInputProps): ReactElement {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const errorId = `${inputId}-error`
  const hasError = error !== null && error !== ''

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange(event.target.value)
  }

  return (
    <div className="decimal-input">
      <label className="decimal-input-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="decimal-input-field"
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
      />
      {hasError ? (
        <p id={errorId} className="decimal-input-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

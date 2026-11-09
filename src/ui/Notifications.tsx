/**
 * `Notifications` — the Tracker's single polite live region (design: UI
 * components — `Notifications`).
 *
 * One `aria-live="polite"` region announces transient status to assistive
 * technology: persist failures, the recovery-write refusal, the backup notice
 * and import/validation results (Req 1.10, 3.8, 8.13, 9.7, 10.14, 12.9, 12.10,
 * 12.16). Keeping a single shared region (rather than scattering `role="alert"`
 * across components) means overlapping messages are announced in order and the
 * app has exactly one place that speaks to the screen reader.
 *
 * This component is presentational: the parent (`App`) maps the store's
 * `Notice` to a sentence with `src/ui/messages.ts` and passes the final string
 * here. A `null` message renders the empty — but still present — region, so the
 * live region exists in the DOM before the first announcement; swapping its
 * text content is what assistive technology announces. `role="status"` pairs
 * with `aria-live="polite"` for broad screen-reader support, and
 * `aria-atomic="true"` makes the whole message read as one unit.
 *
 * No inline styles are used (CSP `style-src 'self'`); the region is positioned
 * and, when empty, visually hidden via the `notifications` class defined in the
 * task-14 stylesheet.
 */

import type { ReactElement } from 'react'

/** Props for {@link Notifications}. */
export interface NotificationsProps {
  /**
   * The message to announce, or `null` when there is nothing to say. The parent
   * derives this from the store's current `Notice` (or other transient state)
   * using the message helpers.
   */
  message: string | null
}

/**
 * Render the shared polite live region. Always renders the container element so
 * the live region is present from first paint; the message text is the region's
 * only child and is cleared to an empty string when `message` is `null`.
 */
export function Notifications({ message }: NotificationsProps): ReactElement {
  return (
    <div className="notifications" role="status" aria-live="polite" aria-atomic="true">
      {message ?? ''}
    </div>
  )
}

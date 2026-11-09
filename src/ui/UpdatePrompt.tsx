/**
 * `UpdatePrompt` — the non-modal banner that offers to apply a downloaded
 * App_Version (design: UI components — `UpdatePrompt`, Req 10.9-10.11).
 *
 * `vite-plugin-pwa` runs with `registerType: 'prompt'`, so a new App_Version is
 * downloaded in the background but never applied without the user's choice.
 * When a worker is waiting, `useAppUpdate` reports `needRefresh`; `App` renders
 * this banner to surface the two choices the design requires:
 * - "Update now" calls `apply()`, which activates the waiting Service_Worker and
 *   reloads into the new version (Req 10.10).
 * - "Later" calls `postpone()`, which hides the prompt and records the choice so
 *   the waiting worker is applied on the next cold start (Req 10.11).
 *
 * The banner is deliberately non-modal: it does not trap focus or block the rest
 * of the app, so the user can keep recording values and apply the update when it
 * suits them. `role="status"` with `aria-live="polite"` announces the
 * availability to assistive technology without interrupting the current task;
 * `aria-atomic="true"` reads the message as one unit. Both controls are real
 * buttons, keyboard operable, and sized through CSS (the task-14 stylesheet
 * gives them the 44px touch target). No inline styles are used (CSP
 * `style-src 'self'`); all presentation comes from the `update-prompt` classes.
 *
 * The component is presentational: it holds no update state of its own and only
 * calls the `apply` / `postpone` callbacks passed by `App` from `useAppUpdate`.
 * `App` decides whether to render it at all (only when `needRefresh` is true),
 * so this component always shows the prompt when mounted.
 */

import type { ReactElement } from 'react'

import { BUTTON_LABELS, UPDATE_AVAILABLE_MESSAGE } from './messages'

/** Props for {@link UpdatePrompt}. */
export interface UpdatePromptProps {
  /** Apply the waiting App_Version immediately and reload (Req 10.10). */
  onApply: () => void
  /** Postpone the update; it is applied on the next launch instead (Req 10.11). */
  onPostpone: () => void
}

/**
 * Render the non-modal update banner. Mount it only when an update is waiting;
 * it announces that a new version is available and offers apply / postpone.
 */
export function UpdatePrompt({ onApply, onPostpone }: UpdatePromptProps): ReactElement {
  return (
    <div className="update-prompt" role="status" aria-live="polite" aria-atomic="true">
      <p className="update-prompt-message">{UPDATE_AVAILABLE_MESSAGE}</p>
      <div className="update-prompt-actions">
        <button type="button" className="update-prompt-apply" onClick={onApply}>
          {BUTTON_LABELS.updateNow}
        </button>
        <button type="button" className="update-prompt-later" onClick={onPostpone}>
          {BUTTON_LABELS.later}
        </button>
      </div>
    </div>
  )
}

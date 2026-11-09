/**
 * `RecoveryBanner` — the banner shown while the Tracker runs in recovery mode
 * (the Unreadable_Data_State) because the persisted data could not be read or
 * failed validation (design: UI components — `RecoveryBanner`, Req 9.4, 9.8).
 *
 * The banner explains the situation and makes clear that the previous data is
 * left untouched until the user acts (Req 9.4). It prefers the store's
 * `startupError` text (the `reason` from the failed load) and falls back to the
 * standard `UNREADABLE_DATA_MESSAGE` from `src/ui/messages.ts`, which already
 * states that the Tracker started empty, the previous data was left untouched,
 * and the two ways forward.
 *
 * It offers the two recovery actions the design requires (Req 9.8):
 * - "Import backup": provided by the self-contained `BackupPanel`, which the
 *   banner renders directly (task 15.2 made `BackupPanel` own its own file
 *   picker and `ImportConfirmDialog`). A confirmed import replaces the whole
 *   Data_Set atomically and leaves recovery mode (Req 12.19, 12.20), after
 *   which the parent (`App`) stops rendering this banner. The banner owns no
 *   import logic itself; it only places the panel where the user needs it.
 * - "Discard unreadable data and start fresh": opens the
 *   `DiscardConfirmDialog`, which warns about permanent deletion and calls
 *   `discardUnreadable()` only after the user confirms (Req 9.9-9.13). On a
 *   successful discard the store leaves recovery mode, this banner's parent
 *   stops rendering it, and the dialog is closed; a cancelled or failed discard
 *   leaves the banner in place.
 *
 * The banner reads its message straight from the snapshot and gets the discard
 * action from `useTrackerActions`, so `App` only needs to decide whether to
 * render it (when `mode === 'recovery'`). It is marked `role="alert"` so
 * assistive technology announces the recovery state when it first appears. No
 * inline styles are used (CSP `style-src 'self'`); sizing and the 44px touch
 * targets come from the task-14 stylesheet via `className`.
 */

import { useState } from 'react'
import type { ReactElement } from 'react'

import { useTrackerActions, useTrackerSnapshot } from '../state/useTracker'
import { BackupPanel } from './BackupPanel'
import { DiscardConfirmDialog } from './DiscardConfirmDialog'
import { BUTTON_LABELS, UNREADABLE_DATA_MESSAGE } from './messages'

/**
 * The recovery-mode banner. Owns only the open-state of the discard
 * confirmation dialog; the recovery message and the discard action come from
 * the store, and the import entry comes from the self-contained `BackupPanel`.
 */
export function RecoveryBanner(): ReactElement {
  const snapshot = useTrackerSnapshot()
  const { discardUnreadable } = useTrackerActions()
  const [discardOpen, setDiscardOpen] = useState(false)

  // Prefer the load failure's reason; fall back to the standard copy, which
  // already states the data was left untouched (Req 9.4).
  const message =
    snapshot.load.phase === 'ready' && snapshot.load.startupError !== null
      ? snapshot.load.startupError
      : UNREADABLE_DATA_MESSAGE

  return (
    <section className="recovery-banner" role="alert" aria-label="Saved data could not be read">
      <p className="recovery-banner-message">{message}</p>
      {/* Import entry (Req 9.8, 12.19, 12.20): the self-contained BackupPanel
          owns the file picker and ImportConfirmDialog. A confirmed import
          leaves recovery mode, so App stops rendering this banner. */}
      <BackupPanel />
      <div className="recovery-banner-actions">
        <button
          type="button"
          className="recovery-banner-discard"
          onClick={() => setDiscardOpen(true)}
        >
          {BUTTON_LABELS.discardUnreadable}
        </button>
      </div>
      <DiscardConfirmDialog
        open={discardOpen}
        onDiscard={discardUnreadable}
        onDiscarded={() => setDiscardOpen(false)}
        onCancel={() => setDiscardOpen(false)}
      />
    </section>
  )
}

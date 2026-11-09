/**
 * `DiscardConfirmDialog` — the confirmation modal shown before discarding
 * unreadable persisted data in recovery mode (design: UI components —
 * `DiscardConfirmDialog`, Req 9.9-9.13).
 *
 * This wraps the shared `ConfirmDialog` primitive, so the native `<dialog>`
 * modal semantics (focus trap, inert background, Escape-to-cancel, backdrop
 * click) come for free. The dialog warns that the unreadable data will be
 * permanently deleted and recommends trying "Import backup" first
 * (`DISCARD_CONFIRM_MESSAGE`, Req 9.9). The destructive confirm button is
 * labelled "Delete and start fresh" and initial focus is placed on Cancel, so
 * a destructive action is never the default target (design: "focus starts on
 * Cancel").
 *
 * Cancel, Escape and a backdrop click all route to `onCancel`, which simply
 * closes the dialog and calls `discardUnreadable()` nowhere — a cancelled
 * confirmation makes no store call and changes nothing (Req 9.10).
 *
 * Confirm calls `discardUnreadable()` from `useTrackerActions` exactly once.
 * The store deletes the unreadable data atomically and, on success, leaves
 * recovery mode with an empty Data_Set (Req 9.11, 9.12) — the parent closes the
 * dialog and the `RecoveryBanner` disappears because the snapshot is no longer
 * in recovery mode. On a `DiscardError` the store stays in recovery mode and
 * the dialog shows the matching message from `discardErrorMessage` inline next
 * to the actions (`failed` / `blocked`, Req 9.13); the shared `Notifications`
 * region also announces it because the store records the notice. The dialog
 * stays open on failure so the user can retry or cancel.
 *
 * No inline styles are used (CSP `style-src 'self'`); all sizing and the 44px
 * touch targets come from the task-14 stylesheet via `className`.
 */

import { useState } from 'react'
import type { ReactElement } from 'react'

import type { DiscardResult } from '../state/TrackerStore'
import { ConfirmDialog } from './ConfirmDialog'
import { BUTTON_LABELS, DISCARD_CONFIRM_MESSAGE, discardErrorMessage } from './messages'

/** Props for {@link DiscardConfirmDialog}. */
export interface DiscardConfirmDialogProps {
  /** Whether the dialog is shown. The parent (`RecoveryBanner`) owns this. */
  open: boolean
  /** Discard action from `useTrackerActions`; called only on confirm. */
  onDiscard: () => Promise<DiscardResult>
  /**
   * Called when the discard succeeds so the parent can close the dialog. The
   * store leaves recovery mode itself; this is purely for closing the modal.
   */
  onDiscarded: () => void
  /** Called when the user cancels, presses Escape, or clicks the backdrop. */
  onCancel: () => void
}

/**
 * The discard confirmation dialog. Holds only the inline error text and the
 * in-flight flag locally; all state about recovery mode lives in the store.
 */
export function DiscardConfirmDialog({
  open,
  onDiscard,
  onDiscarded,
  onCancel,
}: DiscardConfirmDialogProps): ReactElement {
  const [errorText, setErrorText] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)

  const handleConfirm = async (): Promise<void> => {
    if (discarding) return
    setDiscarding(true)
    const result = await onDiscard()
    setDiscarding(false)

    if (result.status === 'discarded') {
      // The store has left recovery mode with an empty Data_Set (Req 9.12).
      setErrorText(null)
      onDiscarded()
      return
    }

    // notDiscarded: stay open and show the matching message inline; the shared
    // Notifications region also announces it (Req 9.13).
    setErrorText(discardErrorMessage(result.reason))
  }

  const handleCancel = (): void => {
    // A cancelled confirmation makes no store call and changes nothing
    // (Req 9.10). Clear any stale error so a later open starts clean.
    setErrorText(null)
    onCancel()
  }

  return (
    <ConfirmDialog
      open={open}
      title="Discard unreadable data"
      confirmLabel={BUTTON_LABELS.deleteAndStartFresh}
      cancelLabel={BUTTON_LABELS.cancel}
      destructive
      initialFocus="cancel"
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    >
      <p className="discard-confirm-message">{DISCARD_CONFIRM_MESSAGE}</p>
      {errorText !== null ? (
        <p className="discard-confirm-error" role="alert">
          {errorText}
        </p>
      ) : null}
    </ConfirmDialog>
  )
}

/**
 * `ConfirmDialog` — a reusable confirm/cancel modal built on the native
 * `<dialog>` element (design: UI components — `ConfirmDialog`).
 *
 * The native `<dialog>` is used deliberately: when opened with
 * `showModal()` the browser provides the modal semantics the design relies on
 * for free — a focus trap inside the dialog, `aria-modal`, inert background,
 * and Escape-to-cancel — without hand-rolled focus management (Req 1.7, 1.8,
 * and the a11y rules; reused by the delete confirmation and extended by
 * `DiscardConfirmDialog` and `ImportConfirmDialog` in later tasks).
 *
 * Behaviour wired here:
 * - Opening: when `open` becomes `true` the dialog is shown with
 *   `showModal()`; when it becomes `false` it is closed. Rendering is
 *   controlled by the parent via `open`, so the dialog is only in the DOM's
 *   top layer while needed.
 * - Escape and backdrop both count as cancel (Req 1.7 / 1.8 wording "cancel or
 *   dismiss"). The native `cancel` event (fired on Escape) is routed to
 *   `onCancel`; a click whose target is the `<dialog>` element itself is a
 *   backdrop click and also cancels.
 * - Initial focus: focus moves to the control named by `initialFocus` once the
 *   dialog opens — `cancel` by default so a destructive confirm is never the
 *   default target (the design puts initial focus on Cancel for the discard
 *   dialog). Consumers that prefer the confirm button pass
 *   `initialFocus="confirm"`.
 * - Labelling: the dialog is titled by its heading via `aria-labelledby` and
 *   described by its body via `aria-describedby`, so assistive technology
 *   announces both when the modal opens.
 *
 * Buttons meet the 44px touch target through the `dialog-button` class
 * (task-14 stylesheet); no inline styles are used (CSP `style-src 'self'`).
 */

import { useCallback, useEffect, useId, useRef } from 'react'
import type { MouseEvent, ReactElement, ReactNode, SyntheticEvent } from 'react'

import { BUTTON_LABELS } from './messages'

/** Which button receives focus when the dialog opens. */
export type ConfirmInitialFocus = 'confirm' | 'cancel'

/** Props for {@link ConfirmDialog}. */
export interface ConfirmDialogProps {
  /** Whether the dialog is shown. The parent owns this state. */
  open: boolean
  /** Short heading announced as the dialog's accessible name. */
  title: string
  /** Body content: the explanatory text (and any extra detail) to confirm. */
  children: ReactNode
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string
  /**
   * When `true`, style the confirm button as a destructive action via the
   * `destructive` class (e.g. delete, discard). Purely visual.
   */
  destructive?: boolean
  /** Which button is focused on open. Defaults to `cancel`. */
  initialFocus?: ConfirmInitialFocus
  /** Called when the user confirms. */
  onConfirm: () => void
  /** Called when the user cancels, presses Escape, or clicks the backdrop. */
  onCancel: () => void
}

/**
 * A modal confirm/cancel dialog. Controlled by `open`; invokes `onConfirm` or
 * `onCancel` and leaves the parent to update `open` in response.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = BUTTON_LABELS.confirm,
  cancelLabel = BUTTON_LABELS.cancel,
  destructive = false,
  initialFocus = 'cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()

  // Open or close the native dialog to match the controlled `open` prop, and
  // move focus to the requested button once it is shown. Using showModal()
  // gives the focus trap, inert backdrop and Escape handling for free.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return

    if (open) {
      if (!dialog.open) {
        dialog.showModal()
      }
      const target = initialFocus === 'confirm' ? confirmRef.current : cancelRef.current
      target?.focus()
    } else if (dialog.open) {
      dialog.close()
    }
  }, [open, initialFocus])

  // Escape fires the dialog's native `cancel` event; treat it as a cancel and
  // prevent the default close so the parent stays the single source of truth
  // for `open` (Req 1.8 / 9.10 "cancel or dismiss").
  const handleCancelEvent = useCallback(
    (event: SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault()
      onCancel()
    },
    [onCancel],
  )

  // A click whose target is the <dialog> element itself landed on the backdrop
  // (clicks on the inner content have a descendant target), so it dismisses.
  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDialogElement>) => {
      if (event.target === dialogRef.current) {
        onCancel()
      }
    },
    [onCancel],
  )

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={handleCancelEvent}
      onClick={handleBackdropClick}
    >
      <div className="confirm-dialog-content">
        <h2 id={titleId} className="confirm-dialog-title">
          {title}
        </h2>
        <div id={bodyId} className="confirm-dialog-body">
          {children}
        </div>
        <div className="confirm-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="dialog-button dialog-button-cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={
              destructive
                ? 'dialog-button dialog-button-confirm destructive'
                : 'dialog-button dialog-button-confirm'
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}

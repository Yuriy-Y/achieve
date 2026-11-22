/**
 * `AppTitle` — the application title as a heading containing a real button, so
 * the Analyser reveal gesture (three activations within 1.5 s, Req 16.1) works
 * with touch, mouse and keyboard (Enter/Space). Single or double activations do
 * nothing; `touch-action: manipulation` (CSS) avoids double-tap zoom.
 */
import { useMemo } from 'react'
import type { ReactElement } from 'react'
import { createRevealDetector } from '../state/reveal'

export interface AppTitleProps {
  /** Called when the reveal gesture completes. */
  onReveal: () => void
}

export function AppTitle({ onReveal }: AppTitleProps): ReactElement {
  const detector = useMemo(() => createRevealDetector(), [])
  return (
    <h1 className="app-title">
      <button
        type="button"
        className="app-title-button"
        onClick={() => {
          if (detector.activate()) onReveal()
        }}
      >
        Achievement Tracker
      </button>
    </h1>
  )
}

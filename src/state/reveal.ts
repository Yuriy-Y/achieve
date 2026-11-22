/**
 * The Analyser reveal gesture (Req 16.1, 16.2): three activations within 1.5 s.
 * Pure and clock-injectable so it is easy to test. One or two activations, or
 * three that are too slow, do nothing.
 */
export const REVEAL_TAPS = 3
export const REVEAL_WINDOW_MS = 1500

export interface RevealDetector {
  /** Register one activation; returns `true` when the gesture just completed. */
  activate(): boolean
}

export function createRevealDetector(now: () => number = () => Date.now()): RevealDetector {
  let times: number[] = []
  return {
    activate(): boolean {
      const t = now()
      times = [...times, t].slice(-REVEAL_TAPS)
      if (times.length === REVEAL_TAPS && t - times[0] <= REVEAL_WINDOW_MS) {
        times = []
        return true
      }
      return false
    },
  }
}

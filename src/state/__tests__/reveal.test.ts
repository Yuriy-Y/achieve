import { REVEAL_WINDOW_MS, createRevealDetector } from '../reveal'

describe('Analyser reveal gesture (Req 16.1, 16.2)', () => {
  const make = () => {
    let t = 1000
    const detector = createRevealDetector(() => t)
    return { activate: (advance = 100) => { t += advance; return detector.activate() } }
  }
  it('does nothing for one or two activations', () => {
    const d = make()
    expect(d.activate()).toBe(false)
    expect(d.activate()).toBe(false)
  })
  it('completes on three quick activations and then resets', () => {
    const d = make()
    d.activate(); d.activate()
    expect(d.activate()).toBe(true)
    expect(d.activate()).toBe(false)
  })
  it('does not complete when the three activations are too slow', () => {
    const d = make()
    d.activate()
    d.activate(REVEAL_WINDOW_MS)
    expect(d.activate(REVEAL_WINDOW_MS)).toBe(false)
  })
  it('uses a sliding window of the last three activations', () => {
    const d = make()
    d.activate(); d.activate(REVEAL_WINDOW_MS) // slow pair
    d.activate(100)
    expect(d.activate(100)).toBe(true)
  })
})

import { chartWindow } from '../granularity'
import { seriesTrend } from '../analyser'
import { TODAY } from './arbitraries'

describe('seriesTrend (Req 16.23)', () => {
  const buckets = chartWindow({ granularity: 'day', span: 'week', anchor: TODAY }, TODAY)
  it('fits a straight line through the started positions', () => {
    const trend = seriesTrend([0n, 1000n, 2000n, 3000n, 0n, 0n, 0n], buckets, TODAY)
    // TODAY is Wednesday: Mon..Wed started => 3 points 0,1000,2000
    expect(trend).not.toBeNull()
  })
  it('detects up, down and flat and needs two started positions', () => {
    const up = seriesTrend(Array.from({ length: 7 }, (_, i) => BigInt(i * 1000)), buckets, '2026-03-22')
    expect(up?.direction).toBe('up')
    expect(up?.slope).toBeCloseTo(1000)
    expect(up?.lastIndex).toBe(6)
    const down = seriesTrend(Array.from({ length: 7 }, (_, i) => BigInt(-i * 500)), buckets, '2026-03-22')
    expect(down?.direction).toBe('down')
    const flat = seriesTrend(Array.from({ length: 7 }, () => 5000n), buckets, '2026-03-22')
    expect(flat?.direction).toBe('flat')
    expect(seriesTrend([5n, 0n, 0n, 0n, 0n, 0n, 0n], buckets, '2026-03-16')).toBeNull() // only Monday started
  })
})

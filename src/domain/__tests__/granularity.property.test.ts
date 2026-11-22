// Feature: achievement-tracker, Property 33: Chart orientation follows the viewport and fits the touch size
// Feature: achievement-tracker, Property 42: Chart_Window structure and totals are consistent across granularities
// Feature: achievement-tracker, Property 43: Window navigation and granularity switching
// Feature: achievement-tracker, Property 44: Per-position goals use the versioned Effective_Goal
// Feature: achievement-tracker, Property 45: Analyser series aggregate entries and ignore choice order
// Feature: achievement-tracker, Property 46: Analyser statistics and ratios match an exact reference
// Feature: achievement-tracker, Property 47: Chart scale draws signed bars from a common baseline
import fc from 'fast-check'
import { addDays, compareDates, currentPeriod, periodOf, periodStart, periodEnd } from '../calendar'
import { dayTotal, type Dataset } from '../dataset'
import {
  BUCKET_WINDOW,
  bucketTotal,
  canGoNext,
  chartWindow,
  defaultWindow,
  shiftWindow,
  switchGranularity,
  switchSpan,
  type Granularity,
  type WindowSpec,
} from '../granularity'
import { analyserModel, analyserSeries, seriesStats, type AnalyserChoice } from '../analyser'
import { goalProgressTenths, goalStatus } from '../stats'
import { resolveEffectiveGoal } from '../goals'
import { createNumberDisplay } from '../numberFormat'
import { chartModel, chartModelV2, chartOrientation, chartScale, analyserChartModel } from '../viewModels'
import { tagKey, weightedValue } from '../tags'
import { arbDay, arbFullDataset, TAG_POOL, TODAY } from './arbitraries'

const fmt = createNumberDisplay(['en-GB'])
const arbSpec: fc.Arbitrary<WindowSpec> = fc.record({
  granularity: fc.constantFrom<Granularity>('day', 'week', 'month'),
  span: fc.constantFrom<'week' | 'month'>('week', 'month'),
  anchor: arbDay,
})

describe('Property 33: orientation', () => {
  it('columns exactly when wide and each position fits', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 288, max: 1920 }),
        fc.integer({ min: 7, max: 31 }),
        fc.integer({ min: 1, max: 6 }),
        (wide, width, count, series) => {
          const per = Math.max(44, 14 * series)
          const o = chartOrientation(wide, width, count, series)
          expect(o).toBe(wide && width >= count * per ? 'columns' : 'rows')
          expect(chartOrientation(wide, width, count)).toBe(wide && width >= count * 44 ? 'columns' : 'rows')
        },
      ),
    )
  })
})

describe('Property 42: window structure', () => {
  it('is ascending, contiguous, correctly sized and contains the anchor', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const buckets = chartWindow(spec, TODAY)
        const size =
          spec.granularity === 'day' ? (spec.span === 'week' ? 7 : buckets.length) : BUCKET_WINDOW
        expect(buckets).toHaveLength(size)
        if (spec.granularity === 'day' && spec.span === 'month') {
          expect(buckets.length).toBeGreaterThanOrEqual(28)
          expect(buckets.length).toBeLessThanOrEqual(31)
        }
        for (let i = 1; i < buckets.length; i += 1) {
          expect(buckets[i].start).toBe(addDays(buckets[i - 1].end, 1))
        }
        const last = buckets[buckets.length - 1]
        if (spec.granularity !== 'day') {
          expect(compareDates(last.start, spec.anchor) <= 0 && compareDates(spec.anchor, last.end) <= 0).toBe(true)
        }
        for (const b of buckets) {
          if (b.kind === 'week') expect(new Date(`${b.start}T00:00:00Z`).getUTCDay()).toBe(1)
          if (b.kind === 'month') expect(b.start.endsWith('-01')).toBe(true)
        }
      }),
    )
  })
  it('bucket totals add up across granularities', () => {
    fc.assert(
      fc.property(arbFullDataset, arbSpec, (ds, spec) => {
        fc.pre(ds.activities.length > 0)
        const a = ds.activities[0].id
        const buckets = chartWindow(spec, TODAY)
        for (const b of buckets) {
          expect(bucketTotal(ds, a, b)).toBe(b.days.reduce((s, d) => s + dayTotal(ds, a, d), 0))
        }
        if (spec.granularity !== 'day') {
          const sumBuckets = buckets.reduce((s, b) => s + bucketTotal(ds, a, b), 0)
          const sumDays = buckets.flatMap((b) => b.days).reduce((s, d) => s + dayTotal(ds, a, d), 0)
          expect(sumBuckets).toBe(sumDays)
        }
      }),
    )
  })
})

describe('Property 43: navigation and switching', () => {
  it('prev then next is the identity when unclamped; next never passes the current period', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        fc.pre(compareDates(spec.anchor, TODAY) <= 0) // windows ending in the future are not reachable
        const prev = shiftWindow(spec, 'prev', TODAY)
        const back = shiftWindow(prev, 'next', TODAY)
        const type = spec.granularity === 'day' ? (spec.span === 'week' ? 'weekly' : 'monthly') : spec.granularity === 'week' ? 'weekly' : 'monthly'
        expect(periodOf(back.anchor, type).key).toBe(periodOf(spec.anchor, type).key)
        const next = shiftWindow(spec, 'next', TODAY)
        const cur = currentPeriod(TODAY, type)
        expect(periodOf(next.anchor, type).key <= cur.key).toBe(true)
        expect(canGoNext(spec, TODAY)).toBe(periodOf(spec.anchor, type).key < cur.key)
        if (!canGoNext(spec, TODAY)) expect(next).toBe(spec)
      }),
    )
  })
  it('switching granularity ends at the position holding min(last day, today)', () => {
    fc.assert(
      fc.property(arbSpec, fc.constantFrom<Granularity>('day', 'week', 'month'), (spec, to) => {
        fc.pre(to !== spec.granularity)
        const before = chartWindow(spec, TODAY)
        const lastDay = before[before.length - 1].end
        const expected = compareDates(lastDay, TODAY) > 0 ? TODAY : lastDay
        const after = switchGranularity(spec, to, TODAY)
        expect(after.granularity).toBe(to)
        expect(after.span).toBe(spec.span)
        const w = chartWindow(after, TODAY)
        const last = w[w.length - 1]
        if (to !== 'day') {
          expect(compareDates(last.start, expected) <= 0 && compareDates(expected, last.end) <= 0).toBe(true)
        } else {
          expect(w.some((b) => b.start === expected)).toBe(true)
        }
      }),
    )
  })
  it('switchSpan follows Req 5.11 and the default window is the previous default', () => {
    expect(defaultWindow(TODAY)).toEqual({ granularity: 'day', span: 'week', anchor: TODAY })
    const w = chartWindow(defaultWindow(TODAY), TODAY)
    expect(w[0].start).toBe(periodStart(currentPeriod(TODAY, 'weekly')))
    expect(w[6].end).toBe(periodEnd(currentPeriod(TODAY, 'weekly')))
    const current = switchSpan(defaultWindow(TODAY), 'month', TODAY)
    expect(chartWindow(current, TODAY)[0].start).toBe(periodStart(currentPeriod(TODAY, 'monthly')))
    const past: WindowSpec = { granularity: 'day', span: 'week', anchor: '2026-02-10' }
    const toMonth = switchSpan(past, 'month', TODAY)
    expect(chartWindow(toMonth, TODAY)[0].start).toBe(periodStart(periodOf(periodStart(periodOf('2026-02-10', 'weekly')), 'monthly')))
  })
  it('Day/Week window equals the previous chart model positions', () => {
    fc.assert(
      fc.property(arbFullDataset, arbDay, (ds, anchor) => {
        fc.pre(ds.activities.length > 0)
        const a = ds.activities[0]
        for (const [span, type] of [['week', 'weekly'], ['month', 'monthly']] as const) {
          const v2 = chartModelV2(ds, a.id, a.name, { granularity: 'day', span, anchor }, TODAY, fmt)
          const old = chartModel(ds, a.id, periodOf(anchor, type), TODAY, fmt)
          expect(v2.title).toBe(old.title)
          expect(v2.positions.map((p) => p.ariaLabel)).toEqual(old.positions.map((p) => p.ariaLabel))
          expect(v2.positions.map((p) => (p.values[0] === null ? null : Number(p.values[0])))).toEqual(
            old.positions.map((p) => p.value),
          )
        }
      }),
    )
  })
})

describe('Property 44: per-position goals', () => {
  it('uses the Effective_Goal of each bucket', () => {
    fc.assert(
      fc.property(arbFullDataset, arbDay, fc.constantFrom<Granularity>('week', 'month'), (ds, anchor, g) => {
        fc.pre(ds.activities.length > 0)
        const a = ds.activities[0]
        const spec: WindowSpec = { granularity: g, span: 'week', anchor }
        const model = chartModelV2(ds, a.id, a.name, spec, TODAY, fmt)
        chartWindow(spec, TODAY).forEach((b, i) => {
          const goal = b.period === null ? null : resolveEffectiveGoal(ds.goalVersions, a.id, b.period)
          const pos = model.positions[i]
          if (goal === null) expect(pos.goal).toBeNull()
          else {
            const total = bucketTotal(ds, a.id, b)
            expect(pos.goal?.value).toBe(goal)
            expect(pos.goal?.progressText).toBe(fmt.progress(goalProgressTenths(total, goal)))
            expect(pos.goal?.status).toBe(goalStatus(total, goal, b.period!, TODAY))
          }
        })
      }),
    )
  })
})

describe('Property 45/46: Analyser', () => {
  const arbChoice: fc.Arbitrary<AnalyserChoice> = fc.record({
    activityIds: fc.subarray(['a0', 'a1', 'a2', 'a3'], { maxLength: 4 }),
    tagKeys: fc.array(fc.constantFrom(...TAG_POOL.map(tagKey)), { maxLength: 4 }),
    includeUntagged: fc.boolean(),
    applyRatios: fc.boolean(),
  })

  const reference = (ds: Dataset, choice: AnalyserChoice, spec: WindowSpec) => {
    const ids = new Set(choice.activityIds)
    const used = ids.size === 0 ? ds.activities : ds.activities.filter((a) => ids.has(a.id))
    const keys = [...new Set(choice.tagKeys)]
    const w = chartWindow(spec, TODAY)
    const entriesOf = (a: string, d: string) => {
      const out: { tags: readonly string[]; value: number }[] = []
      const u = ds.values.get(a)?.get(d)
      if (u !== undefined) out.push({ tags: [], value: u })
      for (const e of ds.taggedValues.get(a)?.get(d)?.values() ?? []) out.push({ tags: e.tags, value: e.value })
      return out
    }
    const sum = (pred: (tags: readonly string[]) => boolean) =>
      w.map((b) => {
        let t = 0n
        for (const a of used) for (const d of b.days) for (const e of entriesOf(a.id, d)) {
          if (pred(e.tags)) t += choice.applyRatios ? weightedValue(e, ds.tagRatios) : BigInt(e.value)
        }
        return t
      })
    const out: bigint[][] = []
    if (keys.length === 0 && !choice.includeUntagged) out.push(sum(() => true))
    else {
      for (const k of keys) out.push(sum((tags) => tags.some((t) => tagKey(t) === k)))
      if (choice.includeUntagged) out.push(sum((tags) => tags.length === 0))
    }
    return out
  }

  it('series values equal the reference aggregation', () => {
    fc.assert(
      fc.property(arbFullDataset, arbChoice, arbSpec, (ds, choice, spec) => {
        const model = analyserModel(ds, choice, spec, TODAY)
        expect(model.series.map((s) => s.values)).toEqual(reference(ds, choice, spec))
      }),
    )
  })
  it('is independent of the order and duplication of choices', () => {
    fc.assert(
      fc.property(arbFullDataset, arbChoice, arbSpec, (ds, choice, spec) => {
        const shuffled: AnalyserChoice = {
          ...choice,
          activityIds: [...choice.activityIds].reverse().concat(choice.activityIds),
          tagKeys: [...choice.tagKeys, ...choice.tagKeys],
        }
        const a = analyserModel(ds, choice, spec, TODAY)
        const b = analyserModel(ds, shuffled, spec, TODAY)
        expect(b.series.map((s) => [s.spec.id, s.values])).toEqual(a.series.map((s) => [s.spec.id, s.values]))
        // series order follows the first appearance of each tag
        expect(analyserSeries(ds, choice).map((s) => s.id)).toEqual(analyserSeries(ds, shuffled).map((s) => s.id))
      }),
    )
  })
  it('"All" with ratios off equals the sum of activity bucket totals', () => {
    fc.assert(
      fc.property(arbFullDataset, arbSpec, (ds, spec) => {
        const model = analyserModel(ds, { activityIds: [], tagKeys: [], includeUntagged: false, applyRatios: false }, spec, TODAY)
        const expected = model.buckets.map((b) =>
          ds.activities.reduce((s, a) => s + BigInt(bucketTotal(ds, a.id, b)), 0n),
        )
        expect(model.series[0].values).toEqual(expected)
        // ratios on but untagged-only data is unchanged: "Not tagged" never changes
        const on = analyserModel(ds, { activityIds: [], tagKeys: [], includeUntagged: true, applyRatios: true }, spec, TODAY)
        const off = analyserModel(ds, { activityIds: [], tagKeys: [], includeUntagged: true, applyRatios: false }, spec, TODAY)
        expect(on.series[0].values).toEqual(off.series[0].values)
      }),
    )
  })
  it('weightedValue matches an exact rational reference', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -999_999_999, max: 999_999_999 }),
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { maxLength: 3 }),
        (value, ratios) => {
          const tags = ratios.map((_, i) => `T${i}`)
          const map = new Map(ratios.map((r, i) => [tagKey(`T${i}`), { ratio: r }]))
          const num = BigInt(value) * ratios.reduce((p, r) => p * BigInt(r), 1n)
          const den = 1000n ** BigInt(ratios.length)
          const mag = num < 0n ? -num : num
          let q = mag / den
          if ((mag % den) * 2n >= den) q += 1n
          expect(weightedValue({ value, tags }, map)).toBe(num < 0n ? -q : q)
        },
      ),
    )
    expect(weightedValue({ value: 5000, tags: [] }, new Map())).toBe(5000n)
    expect(weightedValue({ value: 5000, tags: ['x'] }, new Map())).toBe(5000n)
  })
  it('statistics match the exact reference and ignore future positions', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), { minLength: 12, maxLength: 12 }), arbDay, (values, anchor) => {
        const buckets = chartWindow({ granularity: 'week', span: 'week', anchor }, TODAY)
        const stats = seriesStats(values, buckets, TODAY)
        expect(stats.total).toBe(values.reduce((s, v) => s + v, 0n))
        const started = values.map((v, i) => ({ v, i })).filter(({ i }) => compareDates(buckets[i].start, TODAY) <= 0)
        if (started.length === 0) {
          expect(stats.average).toBeNull()
          expect(stats.highest).toBeNull()
          return
        }
        const sum = started.reduce((s, x) => s + x.v, 0n)
        const n = BigInt(started.length)
        const mag = sum < 0n ? -sum : sum
        let q = mag / n
        if ((mag % n) * 2n >= n) q += 1n
        expect(stats.average).toBe(sum < 0n ? -q : q)
        const max = started.reduce((m, x) => (x.v > m.v ? x : m))
        const min = started.reduce((m, x) => (x.v < m.v ? x : m))
        expect(stats.highest).toEqual({ value: max.v, index: max.i })
        expect(stats.lowest).toEqual({ value: min.v, index: min.i })
      }),
    )
  })
  it('analyserChartModel labels list every series', () => {
    fc.assert(
      fc.property(arbFullDataset, arbChoice, arbSpec, (ds, choice, spec) => {
        const model = analyserModel(ds, choice, spec, TODAY)
        const chart = analyserChartModel(model, spec, TODAY, fmt)
        expect(chart.series).toHaveLength(model.series.length)
        chart.positions.forEach((p) => {
          for (const s of chart.series) expect(p.ariaLabel).toContain(s.label)
        })
      }),
    )
  })
})

describe('Property 47: chart scale', () => {
  it('draws signed bars from one baseline inside the extent', () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.integer({ min: -1_000_000, max: 1_000_000 }), { nil: null }), { maxLength: 20 }),
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { maxLength: 3 }),
        fc.integer({ min: 40, max: 2000 }),
        (values, goals, extent) => {
          const s = chartScale(values, goals, extent)
          const hasNeg = values.some((v) => v !== null && v < 0)
          if (!hasNeg) expect(s.zeroPx).toBe(0)
          for (const v of values) {
            if (v === null) continue
            const end = s.zeroPx + v * s.pxPerUnit
            expect(end).toBeGreaterThanOrEqual(-1e-6)
            expect(end).toBeLessThanOrEqual(extent + 1e-6)
          }
          for (const g of goals) expect(s.zeroPx + g * s.pxPerUnit).toBeLessThanOrEqual(extent + 1e-6)
        },
      ),
    )
  })
})

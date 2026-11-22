// Feature: achievement-tracker, Property 38: Signed Period_Total is the exact sum and edits change it by the delta
// Feature: achievement-tracker, Property 39: Tag validation and canonicalisation match the reference rules
// Feature: achievement-tracker, Property 40: Entry commands keep the tag invariants and isolate changes
// Feature: achievement-tracker, Property 41: Tag suggestions follow the reference rules
// Feature: achievement-tracker, Property 48: Backup format 2 round trip
import fc from 'fast-check'
import { applyCommand, type Command, type CommandContext } from '../commands'
import { parseBackup, serialiseBackup } from '../backup'
import { daysOf, periodOf } from '../calendar'
import { dayTotal, datasetEquals, allTaggedValues, type Dataset } from '../dataset'
import { formatMilli } from '../decimal'
import { periodTotal } from '../stats'
import { comboKey, resolveTags, suggestTags, tagKey, tagLibrary, validateTag } from '../tags'
import { validateDatasetRules } from '../datasetRules'
import { arbDay, arbFullDataset, arbMilliDaily, TAG_POOL, TODAY } from './arbitraries'
import { datasetToRecords } from '../../storage/records'

const ctx: CommandContext = { today: TODAY, now: '2026-03-18T08:00:00.000Z', newId: () => 'new-id' }

function apply(ds: Dataset, cmd: Command): Dataset {
  const r = applyCommand(ds, cmd, ctx)
  if (!r.ok) throw new Error(`rejected: ${JSON.stringify(r.error)}`)
  return r.next
}

/** Invariant I7 for the whole Dataset (Req 14.21). */
function assertTagInvariants(ds: Dataset): void {
  const spelling = new Map<string, string>()
  const seen = new Set<string>()
  for (const { entry, comboKey: key } of allTaggedValues(ds.taggedValues)) {
    expect(entry.tags.length).toBeGreaterThanOrEqual(1)
    expect(entry.tags.length).toBeLessThanOrEqual(3)
    expect(new Set(entry.tags.map(tagKey)).size).toBe(entry.tags.length)
    expect(key).toBe(comboKey(entry.tags))
    const id = `${entry.activityId}|${entry.date}|${key}`
    expect(seen.has(id)).toBe(false)
    seen.add(id)
    for (const t of entry.tags) {
      const prev = spelling.get(tagKey(t))
      if (prev !== undefined) expect(prev).toBe(t)
      spelling.set(tagKey(t), t)
    }
  }
}

describe('Property 38: signed totals and deltas', () => {
  it('periodTotal is the exact sum of day totals and edits change it by the delta', () => {
    fc.assert(
      fc.property(arbFullDataset, fc.nat(5), arbDay, arbMilliDaily(true), (ds, n, date, value) => {
        fc.pre(ds.activities.length > 0)
        const a = ds.activities[n % ds.activities.length].id
        for (const type of ['weekly', 'monthly'] as const) {
          const p = periodOf(date, type)
          const naive = daysOf(p).reduce((sum, d) => sum + dayTotal(ds, a, d), 0)
          expect(periodTotal(ds, a, p)).toBe(naive)
        }
        fc.pre(date <= TODAY)
        const before = periodTotal(ds, a, periodOf(date, 'weekly'))
        const old = ds.values.get(a)?.get(date) ?? 0
        const next = apply(ds, { kind: 'recordValue', activityId: a, date, value: formatMilli(value) })
        expect(periodTotal(next, a, periodOf(date, 'weekly'))).toBe(before + value - old)
        expect(periodTotal(next, a, periodOf(date, 'monthly'))).toBe(
          periodTotal(ds, a, periodOf(date, 'monthly')) + value - old,
        )
      }),
    )
  })
})

describe('Property 39: tag validation', () => {
  const arbRaw = fc.oneof(
    fc.constantFrom(...TAG_POOL, ...TAG_POOL.map((t) => t.toUpperCase()), '', '  ', 'a,b', 'a\nb', ' Gym '),
    fc.string({ maxLength: 40 }),
    fc.string({ minLength: 31, maxLength: 34 }).map((s) => s.replace(/[,\n\r]/g, 'x')),
  )
  it('resolveTags matches a reference implementation', () => {
    fc.assert(
      fc.property(arbFullDataset, fc.array(arbRaw, { maxLength: 5 }), (ds, raws) => {
        const result = resolveTags(raws, tagLibrary(ds))
        // reference
        let expected: { code: string; index: number } | null = null
        const keys = new Set<string>()
        for (let i = 0; i < raws.length && expected === null; i += 1) {
          const t = raws[i].trim()
          if (t === '') expected = { code: 'empty', index: i }
          else if (/[,\n\r]/.test(t)) expected = { code: 'invalidChar', index: i }
          else if (Array.from(t).length > 30) expected = { code: 'tooLong', index: i }
          else if (keys.has(tagKey(t))) expected = { code: 'duplicate', index: i }
          else keys.add(tagKey(t))
        }
        if (expected === null && raws.length > 3) expected = { code: 'tooMany', index: 3 }
        if (expected !== null) {
          expect(result).toEqual({ ok: false, error: expected })
        } else {
          expect(result.ok).toBe(true)
          if (!result.ok) return
          const lib = new Map(tagLibrary(ds).map((e) => [e.key, e.label]))
          result.value.forEach((tag, i) => {
            const key = tagKey(raws[i].trim())
            expect(tag).toBe(lib.get(key) ?? raws[i].trim())
          })
          // combination identity ignores order
          expect(comboKey(result.value)).toBe(comboKey([...result.value].reverse()))
        }
      }),
    )
  })
  it('validateTag counts code points', () => {
    expect(validateTag('😀'.repeat(30)).ok).toBe(true)
    expect(validateTag('😀'.repeat(31)).ok).toBe(false)
  })
})

describe('Property 40: entry commands', () => {
  it('upserts per combination, isolates activities and keeps invariants', () => {
    fc.assert(
      fc.property(
        arbFullDataset,
        fc.nat(5),
        arbDay,
        fc.uniqueArray(fc.constantFrom(...TAG_POOL), { minLength: 1, maxLength: 3 }),
        arbMilliDaily(true),
        (ds, n, date, tags, value) => {
          fc.pre(ds.activities.length > 0 && date <= TODAY)
          const a = ds.activities[n % ds.activities.length].id
          const cmd: Command = { kind: 'recordValue', activityId: a, date, value: formatMilli(value), tags }
          const next = apply(ds, cmd)
          assertTagInvariants(next)
          // same combination in another order and case addresses the same entry
          const again = apply(next, { ...cmd, value: '1', tags: [...tags].reverse().map((t) => t.toUpperCase()) })
          expect(allTaggedValues(again.taggedValues)).toHaveLength(allTaggedValues(next.taggedValues).length)
          assertTagInvariants(again)
          expect(again.taggedValues.get(a)?.get(date)?.get(comboKey(tags))?.value).toBe(1000)
          // other activities and goals untouched
          expect(again.goalVersions).toBe(ds.goalVersions)
          for (const other of ds.activities.filter((x) => x.id !== a)) {
            expect(again.taggedValues.get(other.id)).toBe(ds.taggedValues.get(other.id))
            expect(again.values.get(other.id)).toBe(ds.values.get(other.id))
          }
          // removal
          const removed = apply(again, { kind: 'removeEntry', activityId: a, date, tags })
          expect(removed.taggedValues.get(a)?.get(date)?.get(comboKey(tags))).toBeUndefined()
          assertTagInvariants(removed)
        },
      ),
    )
  })
  it('rejects bad input without a state change', () => {
    fc.assert(
      fc.property(arbFullDataset, (ds) => {
        fc.pre(ds.activities.length > 0)
        const a = ds.activities[0].id
        const bad: Command[] = [
          { kind: 'recordValue', activityId: a, date: TODAY, value: '1', tags: ['a,b'] },
          { kind: 'recordValue', activityId: a, date: TODAY, value: '1', tags: ['a', 'b', 'c', 'd'] },
          { kind: 'recordValue', activityId: a, date: TODAY, value: '1', tags: ['a', 'A'] },
          { kind: 'recordValue', activityId: a, date: '2099-01-01', value: '1', tags: ['a'] },
          { kind: 'recordValue', activityId: a, date: TODAY, value: 'x', tags: ['a'] },
          { kind: 'removeEntry', activityId: a, date: TODAY, tags: [] },
          { kind: 'removeEntry', activityId: a, date: TODAY, tags: ['Nope'] },
          { kind: 'setTagRatio', tag: 'Gym', ratio: '0' },
          { kind: 'setTagRatio', tag: 'Gym', ratio: '1000.001' },
          { kind: 'setTagRatio', tag: 'Gym', ratio: '-1' },
        ]
        for (const cmd of bad) expect(applyCommand(ds, cmd, ctx).ok).toBe(false)
      }),
    )
  })
  it('deleting an activity removes its tagged entries and unused tags leave the library', () => {
    fc.assert(
      fc.property(arbFullDataset, fc.nat(5), (ds, n) => {
        fc.pre(ds.activities.length > 0)
        const a = ds.activities[n % ds.activities.length].id
        const next = apply(ds, { kind: 'deleteActivity', activityId: a })
        expect(next.taggedValues.has(a)).toBe(false)
        const usedKeys = new Set(allTaggedValues(next.taggedValues).flatMap((x) => x.entry.tags.map(tagKey)))
        expect(new Set(tagLibrary(next).map((t) => t.key))).toEqual(usedKeys)
      }),
    )
  })
  it('a new spelling can replace a tag used only by the replaced entry', () => {
    let ds = apply(
      { ...arbEmpty(), activities: [{ id: 'a', name: 'A', createdAt: ctx.now, createdSeq: 1 }] },
      { kind: 'recordValue', activityId: 'a', date: TODAY, value: '1', tags: ['gym'] },
    )
    ds = apply(ds, { kind: 'recordValue', activityId: 'a', date: TODAY, value: '2', tags: ['GYM'] })
    expect(allTaggedValues(ds.taggedValues)[0].entry.tags).toEqual(['GYM'])
  })
})

function arbEmpty(): Dataset {
  return { activities: [], values: new Map(), taggedValues: new Map(), tagRatios: new Map(), goalVersions: [] }
}

describe('Property 41: suggestions', () => {
  it('follows prefix/contains/ordering/limit rules', () => {
    fc.assert(
      fc.property(
        arbFullDataset,
        fc.string({ maxLength: 4 }),
        fc.subarray(TAG_POOL, { maxLength: 3 }),
        (ds, typed, attached) => {
          const lib = tagLibrary(ds)
          const out = suggestTags(lib, typed, attached)
          expect(out.length).toBeLessThanOrEqual(8)
          const attachedKeys = new Set(attached.map(tagKey))
          const byLabel = new Map(lib.map((e) => [e.label, e]))
          const needle = tagKey(typed.trim())
          const candidates = lib.filter((e) => !attachedKeys.has(e.key))
          const prefix = candidates.filter((e) => e.key.startsWith(needle))
          const pool = needle === '' || prefix.length > 0 ? prefix : candidates.filter((e) => e.key.includes(needle))
          for (const label of out) {
            expect(byLabel.has(label)).toBe(true)
            expect(pool.some((e) => e.label === label)).toBe(true)
          }
          const counts = out.map((l) => byLabel.get(l)?.count ?? 0)
          expect([...counts].sort((x, y) => y - x)).toEqual(counts)
          expect(out.length).toBe(Math.min(8, pool.length))
        },
      ),
    )
  })
})

interface Mutable {
  taggedValues: { activityId: string; tags: string[]; value: string }[]
  tagRatios: { tag: string; ratio: string }[]
}

describe('Property 48: backup format 2 and records round trip', () => {
  it('export/import is equivalent and idempotent, with tags, ratios and negatives', () => {
    fc.assert(
      fc.property(arbFullDataset, (ds) => {
        const text = serialiseBackup(ds, new Date('2026-03-18T08:00:00.000Z'))
        const parsed = parseBackup(text)
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) return
        expect(datasetEquals(parsed.value.dataset, ds)).toBe(true)
        expect(serialiseBackup(parsed.value.dataset, new Date('2026-03-18T08:00:00.000Z'))).toBe(text)
      }),
    )
  })
  it('storage records round-trip through validateDatasetRules', () => {
    fc.assert(
      fc.property(arbFullDataset, (ds) => {
        const rec = datasetToRecords(ds)
        const back = validateDatasetRules(rec, 'milli', { allowNegative: true, tagged: 'optional' })
        expect(back.ok).toBe(true)
        if (back.ok) expect(datasetEquals(back.value, ds)).toBe(true)
      }),
    )
  })
  it('rejects malformed format 2 files', () => {
    const ds = apply(
      { ...arbEmpty(), activities: [{ id: 'a', name: 'A', createdAt: ctx.now, createdSeq: 1 }] },
      { kind: 'recordValue', activityId: 'a', date: TODAY, value: '-2.5', tags: ['Gym', 'Rain'] },
    )
    const base = JSON.parse(serialiseBackup(ds, new Date()))
    const mutate = (fn: (o: Mutable) => void): boolean => {
      const o = JSON.parse(JSON.stringify(base)) as Mutable
      fn(o)
      return parseBackup(JSON.stringify(o)).ok
    }
    expect(mutate(() => {})).toBe(true)
    expect(mutate((o) => Reflect.deleteProperty(o, 'taggedValues'))).toBe(false)
    expect(mutate((o) => Reflect.deleteProperty(o, 'tagRatios'))).toBe(false)
    expect(mutate((o) => (o.taggedValues[0].tags = ['Gym', 'gym']))).toBe(false)
    expect(mutate((o) => (o.taggedValues[0].tags = []))).toBe(false)
    expect(mutate((o) => (o.taggedValues[0].tags = ['a', 'b', 'c', 'd']))).toBe(false)
    expect(mutate((o) => (o.taggedValues[0].value = '-0.000'))).toBe(false)
    expect(mutate((o) => o.taggedValues.push({ ...o.taggedValues[0], tags: ['Rain', 'Gym'] }))).toBe(false)
    expect(mutate((o) => (o.taggedValues[0].activityId = 'zzz'))).toBe(false)
    expect(mutate((o) => (o.tagRatios = [{ tag: 'Gym', ratio: '0.000' }]))).toBe(false)
    expect(mutate((o) => (o.tagRatios = [{ tag: 'Gym', ratio: '1000.001' }]))).toBe(false)
    expect(mutate((o) => (o.tagRatios = [{ tag: 'gym', ratio: '1.500' }]))).toBe(false) // spelling clash
    expect(mutate((o) => (o.tagRatios = [{ tag: 'Gym', ratio: '1.500' }]))).toBe(true)
    expect(mutate((o) => (o.tagRatios = [{ tag: 'Gym', ratio: '1.500' }, { tag: 'Gym', ratio: '2.000' }]))).toBe(false)
  })
})

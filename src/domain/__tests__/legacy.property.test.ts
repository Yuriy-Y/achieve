// Feature: achievement-tracker, Property 36: Legacy data loads unchanged and equivalent
// Feature: achievement-tracker, Property 48 (format 1 half): Backup format 1 compatibility
import fc from 'fast-check'
import { IDBFactory } from 'fake-indexeddb'
import { BACKUP_V1_TEXT } from './legacy/fixtures/backupV1'
import { activityListModel, chartModel } from '../viewModels'
import { periodTotal } from '../stats'
import { currentPeriod, periodOf } from '../calendar'
import { createNumberDisplay } from '../numberFormat'
import { datasetEquals, type Dataset } from '../dataset'
import { parseBackup, serialiseBackup } from '../backup'
import { IndexedDbStorage } from '../../storage/IndexedDbStorage'
import { arbLegacyDataset, TODAY } from './arbitraries'
import * as legacyViews from './legacy/viewModels'
import * as legacyStats from './legacy/stats'
import * as legacyBackup from './legacy/backup'
import { datasetToRecords as legacyRecords } from './legacy/records'

const fmt = createNumberDisplay(['en-GB'])

describe('Property 36: legacy equivalence', () => {
  it('list, chart and totals equal the frozen pre-extension implementation', () => {
    fc.assert(
      fc.property(arbLegacyDataset, (ds) => {
        expect(activityListModel(ds, TODAY, fmt)).toEqual(legacyViews.activityListModel(ds, TODAY, fmt))
        for (const a of ds.activities) {
          for (const type of ['weekly', 'monthly'] as const) {
            for (const period of [currentPeriod(TODAY, type), periodOf('2026-02-10', type)]) {
              expect(chartModel(ds, a.id, period, TODAY, fmt)).toEqual(
                legacyViews.chartModel(ds, a.id, period, TODAY, fmt),
              )
              expect(periodTotal(ds, a.id, period)).toBe(legacyStats.periodTotal(ds.values, a.id, period))
            }
          }
        }
      }),
    )
  })
})

describe('Property 48 (format 1): legacy backups import unchanged', () => {
  it('a frozen format 1 export parses into an equivalent dataset without tags or ratios', () => {
    fc.assert(
      fc.property(arbLegacyDataset, (ds) => {
        const text = legacyBackup.serialiseBackup(ds, new Date('2026-03-18T08:00:00.000Z'))
        const parsed = parseBackup(text)
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) return
        expect(datasetEquals(parsed.value.dataset, ds)).toBe(true)
        expect(parsed.value.dataset.taggedValues.size).toBe(0)
        expect(parsed.value.dataset.tagRatios.size).toBe(0)
        // legacy -> new export (format 2) -> import is equivalent (Req 17.8)
        const again = parseBackup(serialiseBackup(parsed.value.dataset, new Date()))
        expect(again.ok && datasetEquals(again.value.dataset, ds)).toBe(true)
      }),
    )
  })

  it('the real format 1 fixture imports', () => {
    const text = BACKUP_V1_TEXT
    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.meta.formatVersion).toBe(1)
      expect(parsed.value.dataset.activities).toHaveLength(2)
    }
  })

  it('rejects format 1 files with tagged lists or negative values', () => {
    const base = JSON.parse(BACKUP_V1_TEXT)
    expect(parseBackup(JSON.stringify({ ...base, taggedValues: [], tagRatios: [] })).ok).toBe(false)
    const neg = JSON.parse(JSON.stringify(base))
    neg.dailyValues[0].value = '-1.000'
    expect(parseBackup(JSON.stringify(neg)).ok).toBe(false)
  })
})

/** Seed a version 1 database exactly like the previous release wrote it. */
async function seedV1(ds: Dataset): Promise<void> {
  const records = legacyRecords(ds)
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('achievement-tracker', 1)
    open.onupgradeneeded = () => {
      const db = open.result
      db.createObjectStore('meta', { keyPath: 'key' })
      db.createObjectStore('activities', { keyPath: 'id' })
      db.createObjectStore('dailyValues', { keyPath: ['activityId', 'date'] })
      db.createObjectStore('goalVersions', { keyPath: ['activityId', 'goalType', 'startPeriod'] })
    }
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(['meta', 'activities', 'dailyValues', 'goalVersions'], 'readwrite')
      tx.objectStore('meta').put({ key: 'schema', version: 1 })
      records.activities.forEach((r) => tx.objectStore('activities').put(r))
      records.dailyValues.forEach((r) => tx.objectStore('dailyValues').put(r))
      records.goalVersions.forEach((r) => tx.objectStore('goalVersions').put(r))
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    open.onerror = () => reject(open.error)
  })
}

async function dump(): Promise<{ version: number; stores: Record<string, unknown[]> }> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('achievement-tracker')
    open.onsuccess = async () => {
      const db = open.result
      const names = [...db.objectStoreNames].sort()
      const tx = db.transaction(names, 'readonly')
      const stores: Record<string, unknown[]> = {}
      await Promise.all(
        names.map(
          (n) =>
            new Promise<void>((res) => {
              const r = tx.objectStore(n).getAll()
              r.onsuccess = () => {
                stores[n] = r.result
                res()
              }
            }),
        ),
      )
      const version = db.version
      db.close()
      resolve({ version, stores })
    }
    open.onerror = () => reject(open.error)
  })
}

describe('Property 36: legacy database upgrade', () => {
  it('upgrades a version 1 database without rewriting any record', async () => {
    await fc.assert(
      fc.asyncProperty(arbLegacyDataset, async (ds) => {
        globalThis.indexedDB = new IDBFactory()
        fc.pre(ds.activities.length > 0)
        await seedV1(ds)
        const before = await dump()
        const result = await new IndexedDbStorage().load()
        expect(result.status).toBe('loaded')
        if (result.status !== 'loaded') return
        expect(datasetEquals(result.dataset, ds)).toBe(true)
        expect(result.dataset.taggedValues.size).toBe(0)
        const after = await dump()
        expect(after.version).toBe(2)
        expect(after.stores.taggedValues).toEqual([])
        expect(after.stores.tagRatios).toEqual([])
        for (const name of ['meta', 'activities', 'dailyValues', 'goalVersions']) {
          expect(after.stores[name]).toEqual(before.stores[name])
        }
      }),
      { numRuns: 25 },
    )
  })
})

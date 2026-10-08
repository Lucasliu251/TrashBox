import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseOwCatalog, parseOwIndex, parseOwLeaderboard, parseOwStatsSnapshot, officialAssetUrl } from '../src/features/ow/types.ts'

const directory = new URL('../public/ow-data/', import.meta.url)
const catalog = parseOwCatalog(JSON.parse(await readFile(new URL('catalog.json', directory), 'utf8')))
const heroIds = new Set(catalog.heroes.map(hero => hero.id))
let inspected = 0
for (const entry of catalog.available) {
  const snapshot = parseOwStatsSnapshot(JSON.parse(await readFile(new URL(entry.file, directory), 'utf8')))
  assert.deepEqual(snapshot.selection, { mode: entry.mode, seasonId: entry.seasonId, rankId: entry.rankId })
  assert.equal(snapshot.date, entry.date)
  assert.equal(snapshot.fetchedAt, entry.fetchedAt)
  const source = new URL(snapshot.sourceUrl)
  assert.equal(source.searchParams.get('game_mode'), entry.mode)
  assert.equal(source.searchParams.get('season'), entry.seasonId)
  assert.equal(source.searchParams.get('mmr'), entry.rankId)
  for (const row of snapshot.rows) {
    // Unknown future IDs should be allowed by the runtime parser. Current captured
    // source evidence, however, must have all portraits accounted for.
    assert(heroIds.has(row.heroId), `Uncatalogued captured hero: ${row.heroId}`)
    if (entry.mode === 'kuaisu') assert.equal(row.banRate, null)
  }
  inspected += snapshot.rows.length
}
for (const tag of ['enhances', 'weakens', 'adjusts']) {
  for (const heroId of catalog.patch[tag]) assert(heroIds.has(heroId), `Uncatalogued patch hero: ${heroId}`)
}
assert(catalog.available.some(entry => entry.mode === 'jingji' && entry.seasonId === catalog.currentSeasonId && entry.rankId === '-127'))

// Contract boundaries: an HTTP-200 maintenance response must never be rendered as
// a valid empty leaderboard, and percentage fields are already percent values.
const row = { hero_id: 'new-future-hero', hero_type: '1', selection_ratio: 5.32, ban_ratio: 0, win_ratio: 46.67, kda: 3.8, ds: '2026-10-07' }
const success = data => ({ code: 0, data })
assert.equal(parseOwLeaderboard(success([row]), 'jingji')[0].pickRate, 5.32)
assert.equal(parseOwLeaderboard(success([row]), 'jingji')[0].heroId, 'new-future-hero')
assert.equal(parseOwLeaderboard(success([row]), 'kuaisu')[0].banRate, null)
assert.equal(parseOwLeaderboard(success([{ ...row, kda: null }]), 'jingji')[0].kda, null)
assert.throws(() => parseOwLeaderboard({ code: 20008, message: '系统维护中', data: [] }, 'jingji'))
assert.throws(() => parseOwLeaderboard(success([]), 'jingji'))
assert.throws(() => parseOwLeaderboard(success([row, row]), 'jingji'))
assert.throws(() => parseOwLeaderboard(success([row, { ...row, hero_id: 'another', ds: '2026-10-08' }]), 'jingji'))
assert.throws(() => parseOwLeaderboard(success([{ ...row, win_ratio: 4670 }]), 'jingji'))
assert.throws(() => parseOwLeaderboard(success([{ ...row, kda: Number.NaN }]), 'jingji'))
assert.throws(() => parseOwLeaderboard(success([{ ...row, hero_type: '9' }]), 'jingji'))
assert.throws(() => officialAssetUrl('https://untrusted.example/portrait.png'))
assert.throws(() => officialAssetUrl('http://ld5.res.netease.com/portrait.png'))
assert.throws(() => parseOwCatalog({ ...catalog, available: [{ ...catalog.available[0], file: '../private.json' }] }))

const overlappingIndex = parseOwIndex(success({
  hero_configs: catalog.heroSourceUrl,
  patch_desc: { date: '2026/7/15', enhances: [], weakens: ['sigma'], adjusts: ['sigma'] },
  seasons: [{ id: 'next-season', name: '未来赛季', desc: '' }],
}))
assert.deepEqual(overlappingIndex.patch.weakens, ['sigma'])
assert.deepEqual(overlappingIndex.patch.adjusts, ['sigma'])
assert.equal(overlappingIndex.seasons[0].id, 'next-season')

console.log(`OW data contract passed: ${catalog.heroes.length} official heroes, ${catalog.available.length} filter combinations, ${inspected} captured rows; maintenance/metric/duplicate/date/asset checks passed.`)

// Execute the actual TypeScript adapter with isolated fetch fixtures; no network or database.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { parseOwIndex, parseOwLeaderboard, parseOwStatsSnapshot } from '../src/features/ow/types.ts'

const adapterUrl = new URL('../src/features/ow/api.ts', import.meta.url)
const adapterSource = await readFile(adapterUrl, 'utf8')
const typesUrl = new URL('../src/features/ow/types.ts', import.meta.url).href
const directory = new URL('../public/ow-data/', import.meta.url)
const captured = JSON.parse(await readFile(new URL('catalog.json', directory), 'utf8'))
const entry = captured.available.find(item => item.mode === 'jingji' && item.seasonId === captured.currentSeasonId && item.rankId === '-127')
const snapshot = JSON.parse(await readFile(new URL(entry.file, directory), 'utf8'))
const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout
const heroSourceUrl = captured.heroSourceUrl
const rawHeroes = { heroConfigs: captured.heroes.map(hero => ({
  id: hero.id, name: hero.name, headSrc: hero.avatarUrl, picList: hero.artUrl ? [hero.artUrl] : [],
  type: { '1': 'Damage', '2': 'Tank', '3': 'Support' }[hero.catalogRole], isNew: hero.isNew,
})) }
const rawRows = snapshot.rows.map(row => ({
  hero_id: row.heroId, hero_type: row.role, win_ratio: row.winRate, selection_ratio: row.pickRate,
  ban_ratio: row.banRate, kda: row.kda, ds: row.date,
}))
const latestIndex = {
  code: 0, data: {
    hero_configs: heroSourceUrl,
    patch_desc: { date: '2026/10/08', enhances: ['kiriko'], weakens: ['sigma'], adjusts: ['sigma'] },
    seasons: [{ id: '6', name: '新赛季测试夹具', desc: '' }, { id: captured.currentSeasonId, name: '上赛季测试夹具', desc: '' }],
  },
}
let moduleNumber = 0
async function moduleFor(env = {}) {
  const injected = { BASE_URL: '/', DEV: true, VITE_OW_LIVE_BASE: '', ...env }
  const source = 'const adapterTestEnv = ' + JSON.stringify(injected) + ';\n' + adapterSource
    .replaceAll('import.meta.env', 'adapterTestEnv')
    .replace("from './types'", 'from ' + JSON.stringify(typesUrl))
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  return import('data:text/javascript;base64,' + Buffer.from(code + '\n// fixture ' + (++moduleNumber)).toString('base64'))
}
function response(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }) }
function fixture(routes) {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    url = String(url)
    calls.push({ url, options })
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
    if (url === '/ow-data/catalog.json') return response(captured)
    if (Object.hasOwn(routes, url)) {
      const handler = routes[url]
      return typeof handler === 'function' ? handler(options) : response(handler)
    }
    if (url === '/ow-data/' + entry.file) return response(snapshot)
    throw new Error('Unexpected fixture request: ' + url)
  }
  return calls
}
const currentUrl = '/ow-live/hero_leaderboard?game_mode=jingji&season=' + captured.currentSeasonId + '&mmr=-127'
try {
  // Newly advertised seasons are followed immediately, even without a collected file.
  let calls = fixture({
    '/ow-live/index': latestIndex,
    [heroSourceUrl]: rawHeroes,
    '/ow-live/hero_leaderboard?game_mode=jingji&season=6&mmr=-127': { code: 0, data: rawRows },
  })
  let api = await moduleFor()
  const live = await api.loadOwHomeData({ preferLive: true })
  assert.equal(live.catalog.source, 'live')
  assert.equal(live.catalog.heroesSource, 'live')
  assert.equal(live.catalog.currentSeasonId, '6')
  assert.equal(live.catalog.patch.date, '2026/10/08')
  assert.deepEqual(live.catalog.patch.weakens, live.catalog.patch.adjusts)
  assert.equal(live.stats.source, 'live')
  assert.equal(live.stats.selection.seasonId, '6')
  assert.equal(live.stats.rows[0].pickRate, snapshot.rows[0].pickRate)
  for (const call of calls.filter(call => call.url.startsWith('/ow-live/'))) {
    assert.equal(call.options.cache, 'no-store')
    assert.equal(call.options.credentials, 'omit')
  }
  const lastSuccessful = await api.loadOwHomeData({ preferLive: true })
  assert.equal(calls.filter(call => call.url === '/ow-live/index').length, 2, 'Live metadata must not use a permanent module cache')

  // A later outage must retain the successful new season with honest historical
  // provenance, rather than rolling metadata and metrics back to the bundled season.
  calls = fixture({
    '/ow-live/index': () => { throw new Error('Metadata outage') },
    '/ow-live/hero_leaderboard?game_mode=jingji&season=6&mmr=-127': { code: 20008, data: [] },
  })
  const warmOutage = await api.loadOwHomeData()
  assert.equal(warmOutage.catalog.currentSeasonId, '6')
  assert.equal(warmOutage.catalog.source, 'snapshot')
  assert.equal(warmOutage.catalog.fetchedAt, lastSuccessful.catalog.fetchedAt)
  assert.equal(warmOutage.catalog.patch.date, lastSuccessful.catalog.patch.date)
  assert(Date.parse(warmOutage.catalog.checkedAt) >= Date.parse(lastSuccessful.catalog.checkedAt))
  assert.equal(warmOutage.stats.source, 'snapshot')
  assert.equal(warmOutage.stats.selection.seasonId, '6')
  assert.equal(warmOutage.stats.fetchedAt, lastSuccessful.stats.fetchedAt)
  assert(warmOutage.catalog.liveError && warmOutage.stats.liveError)
  assert(!calls.some(call => call.url === currentUrl || call.url === '/ow-data/' + entry.file))

  calls = fixture({
    '/ow-live/index': latestIndex, [heroSourceUrl]: rawHeroes,
    '/ow-live/hero_leaderboard?game_mode=jingji&season=6&mmr=-127': { code: 20008, data: [] },
  })
  const warmStatsOutage = await api.loadOwHomeData()
  assert.equal(warmStatsOutage.catalog.source, 'live')
  assert.equal(warmStatsOutage.stats.source, 'snapshot')
  assert.equal(warmStatsOutage.stats.selection.seasonId, '6')
  assert.equal(warmStatsOutage.stats.fetchedAt, lastSuccessful.stats.fetchedAt)
  assert(!calls.some(call => call.url === currentUrl || call.url === '/ow-data/' + entry.file))

  // Index and patch metadata stay live when the CDN fails independently.
  fixture({
    '/ow-live/index': latestIndex,
    [heroSourceUrl]: () => { throw new Error('CDN unavailable') },
    '/ow-live/hero_leaderboard?game_mode=jingji&season=6&mmr=-127': { code: 0, data: rawRows },
  })
  api = await moduleFor()
  const mixedHeroes = await api.loadOwHomeData()
  assert.equal(mixedHeroes.catalog.source, 'live')
  assert.equal(mixedHeroes.catalog.heroesSource, 'snapshot')
  assert.equal(mixedHeroes.catalog.patch.date, '2026/10/08')

  // No current-season statistics: keep current tags but clear metrics, never relabel old data.
  calls = fixture({
    '/ow-live/index': latestIndex, [heroSourceUrl]: rawHeroes,
    '/ow-live/hero_leaderboard?game_mode=jingji&season=6&mmr=-127': { code: 20008, data: [] },
  })
  api = await moduleFor()
  const unavailableSeason = await api.loadOwHomeData()
  assert.equal(unavailableSeason.catalog.currentSeasonId, '6')
  assert.equal(unavailableSeason.stats, null)
  assert(unavailableSeason.statsError)
  assert(!calls.some(call => call.url === '/ow-data/' + entry.file), 'A different-season snapshot must not be fetched')

  // A historically retained but verified new season can still be retried live,
  // even when it has neither a successful statistics cache nor a bundled file.
  calls = fixture({
    '/ow-live/index': () => { throw new Error('Metadata outage') },
    '/ow-live/hero_leaderboard?game_mode=jingji&season=6&mmr=-127': { code: 0, data: rawRows },
  })
  const recoveredNewSeason = await api.loadOwHomeData()
  assert.equal(recoveredNewSeason.catalog.source, 'snapshot')
  assert.equal(recoveredNewSeason.catalog.currentSeasonId, '6')
  assert.equal(recoveredNewSeason.stats.source, 'live')
  assert.equal(recoveredNewSeason.stats.selection.seasonId, '6')
  assert(!calls.some(call => call.url === currentUrl || call.url === '/ow-data/' + entry.file))

  // HTTP-200 maintenance is rejected and only the matching collected season is used.
  const sameSeasonIndex = structuredClone(latestIndex)
  sameSeasonIndex.data.seasons = [{ id: captured.currentSeasonId, name: '当前赛季测试夹具', desc: '' }]
  fixture({
    '/ow-live/index': sameSeasonIndex, [heroSourceUrl]: rawHeroes,
    [currentUrl]: { code: 20008, message: '系统维护中', data: [] },
  })
  api = await moduleFor()
  const fallback = await api.loadOwHomeData()
  assert.equal(fallback.catalog.source, 'live')
  assert.equal(fallback.stats.source, 'snapshot')
  assert.equal(fallback.stats.fetchedAt, snapshot.fetchedAt)
  assert.equal(fallback.stats.selection.seasonId, captured.currentSeasonId)
  assert(fallback.stats.liveError)

  // An absent production adapter is visibly snapshot data; a configured fixed path works.
  fixture({ '/ow-live/index': () => response({}, 404), [currentUrl]: () => response({}, 404) })
  api = await moduleFor({ DEV: false })
  const productionFallback = await api.loadOwHomeData()
  assert.equal(productionFallback.catalog.source, 'snapshot')
  assert.equal(productionFallback.catalog.fetchedAt, captured.fetchedAt)
  assert.equal(productionFallback.stats.source, 'snapshot')
  assert(productionFallback.catalog.liveError)
  calls = fixture({
    '/ow-public/index': latestIndex, [heroSourceUrl]: rawHeroes,
    '/ow-public/hero_leaderboard?game_mode=jingji&season=6&mmr=-127': { code: 0, data: rawRows },
  })
  api = await moduleFor({ DEV: false, VITE_OW_LIVE_BASE: '/ow-public' })
  assert.equal((await api.loadOwHomeData()).stats.source, 'live')
  assert(calls.some(call => call.url.startsWith('/ow-public/')))

  calls = fixture({})
  api = await moduleFor({ VITE_OW_LIVE_BASE: 'https://untrusted.example/proxy' })
  assert.equal((await api.loadOwHomeData()).catalog.source, 'snapshot')
  assert(calls.every(call => call.url.startsWith('/ow-data/')), 'Adapter config must not become an arbitrary URL proxy')

  // A timed-out request gets bounded fallback, while caller cancellation propagates.
  globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay === 8000 ? 15 : delay, ...args)
  fixture({
    '/ow-live/index': options => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })),
    [currentUrl]: { code: 20008, data: [] },
  })
  api = await moduleFor()
  assert.equal((await api.loadOwHomeData()).catalog.source, 'snapshot')
  globalThis.setTimeout = originalSetTimeout
  api = await moduleFor()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => api.loadOwHomeData({ signal: controller.signal }), { name: 'AbortError' })

  // JavaScript normalizes impossible dates; the source contract must reject them.
  assert.throws(() => parseOwIndex({ ...latestIndex, data: { ...latestIndex.data, patch_desc: { ...latestIndex.data.patch_desc, date: '2026/2/30' } } }))
  assert.throws(() => parseOwLeaderboard({ code: 0, data: [{ ...rawRows[0], ds: '2026-02-30' }] }, 'jingji'))
  assert.throws(() => parseOwStatsSnapshot({ ...snapshot, selection: { ...snapshot.selection, seasonId: '6' } }), /来源与筛选不一致/)
  console.log('OW live pipeline passed: fresh metadata, new seasons, exact bundled and warm-cache fallback, independent CDN failure, production adapter configuration, cache bypass, timeout, cancellation, and real calendar dates.')
} finally {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
}

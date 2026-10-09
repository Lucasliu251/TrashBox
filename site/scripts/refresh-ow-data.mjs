// Node 22.18+ (native TypeScript stripping). Captures anonymous hero aggregates only.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseOwIndex, parseOwHeroes, parseOwLeaderboard, parseOwCatalog, parseOwStatsSnapshot, officialAssetUrl } from '../src/features/ow/types.ts'

const API = 'https://webapi.blizzard.cn/ow-armory-server/'
const PAGE = 'https://ow.blizzard.cn/herolist/'
const CLIENT = 'https://ld5.res.netease.com/pc/zt/20250326092201/js/index_a9b2cfaa.js'
const ASSETS = 'https://ld5.res.netease.com/pc/zt/20250326092201/assets/'
const destination = path.resolve(fileURLToPath(new URL('../public/ow-data/', import.meta.url)))
const staging = path.join(path.dirname(destination), `.ow-data-${process.pid}`)
const modes = [{ id: 'jingji', name: '竞技比赛' }, { id: 'kuaisu', name: '快速比赛' }]
// Names/keys match the official public leaderboard client, not overseas tiers.
const ranks = [
  { id: '-127', name: '全部段位' }, { id: 'Bronze', name: '青铜' },
  { id: 'Silver', name: '白银' }, { id: 'Gold', name: '黄金' },
  { id: 'Platinum', name: '白金' }, { id: 'Emerald', name: '翡翠' },
  { id: 'Diamond', name: '钻石' }, { id: 'Master', name: '大师' },
  { id: 'Grandmaster', name: '宗师' }, { id: 'Champion', name: '英杰' },
]

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), credentials: 'omit' })
  if (!response.ok) throw new Error(`HTTP ${response.status} while reading ${new URL(url).pathname}`)
  return response.json()
}

async function json(file, value) {
  await writeFile(path.join(staging, file), `${JSON.stringify(value, null, 2)}\n`)
}

await mkdir(staging, { recursive: true })
try {
  const index = parseOwIndex(await get(`${API}index`))
  const heroes = parseOwHeroes(await get(index.heroSourceUrl))
  const fetchedAt = new Date().toISOString()
  const currentSeasonId = index.seasons[0].id
  const combinations = ranks.map(rank => ({ mode: 'jingji', seasonId: currentSeasonId, rankId: rank.id }))
  combinations.push({ mode: 'kuaisu', seasonId: currentSeasonId, rankId: '-127' })
  // Keep a previous-season comparison available, without multiplying every tier.
  for (const season of index.seasons.slice(1, 2)) {
    for (const mode of modes) combinations.push({ mode: mode.id, seasonId: season.id, rankId: '-127' })
  }
  const available = []
  const failures = []
  const qualityIssues = new Map()
  for (const selection of combinations) {
    const query = new URLSearchParams({ game_mode: selection.mode, season: selection.seasonId, mmr: selection.rankId })
    const sourceUrl = `${API}hero_leaderboard?${query}`
    try {
      const rows = parseOwLeaderboard(await get(sourceUrl), selection.mode)
      const filename = `${selection.mode}-${selection.seasonId}-${selection.rankId === '-127' ? 'all' : selection.rankId}.json`
      const snapshot = parseOwStatsSnapshot({ schemaVersion: 1, fetchedAt: new Date().toISOString(), sourceUrl, selection, date: rows[0].date, rows })
      await json(filename, snapshot)
      available.push({ ...selection, file: filename, date: snapshot.date, fetchedAt: snapshot.fetchedAt })
      for (const row of rows) {
        const hero = heroes.find(item => item.id === row.heroId)
        if (hero && hero.catalogRole !== row.role) qualityIssues.set(row.heroId, { heroId: row.heroId, catalogRole: hero.catalogRole, statsRole: row.role })
      }
      console.log(`${selection.mode} / ${selection.seasonId} / ${selection.rankId}: ${rows.length} heroes, ${snapshot.date}`)
    } catch (error) {
      failures.push({ ...selection, reason: error instanceof Error ? error.message : 'Invalid upstream response' })
      console.warn(`Unavailable: ${selection.mode} / ${selection.seasonId} / ${selection.rankId}`)
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  if (!available.some(item => item.mode === 'jingji' && item.seasonId === currentSeasonId && item.rankId === '-127')) {
    throw new Error('Current competitive aggregate missing; previous published snapshot remains untouched')
  }
  const assets = {
    masthead: `${ASSETS}kv-2560_6027b981.jpg`,
    roleIcons: { '1': `${ASSETS}icon-sc_5cba6026.png`, '2': `${ASSETS}icon-zz_5a3502eb.png`, '3': `${ASSETS}icon-zy_1f3c3d2a.png` },
    patchIcons: { enhances: `${ASSETS}icon-jqzq_86bd6ec2.png`, weakens: `${ASSETS}icon-jqxr_d6e51b7e.png`, adjusts: `${ASSETS}icon-jqtz_d411a3e2.png` },
  }
  const catalog = parseOwCatalog({
    schemaVersion: 1, fetchedAt, sourceUrl: `${API}index`, heroSourceUrl: index.heroSourceUrl,
    heroes, patch: index.patch, seasons: index.seasons, currentSeasonId, modes, ranks,
    available, assets, qualityIssues: [...qualityIssues.values()],
  })
  await json('catalog.json', catalog)
  await json('source-manifest.json', {
    schemaVersion: 1, observedAt: fetchedAt, sourcePage: PAGE,
    indexUrl: `${API}index`, heroConfigUrl: index.heroSourceUrl, rankConfigurationSource: CLIENT,
    publicAggregateOnly: true, licensing: 'Official public assets are attributed; no independent redistribution license has been verified.',
    assetDelivery: 'Direct HTTPS references to the official CDN; no private or arbitrary asset proxy.',
    sourceNotes: [
      'Metrics are the source percentage values; do not multiply by 100.',
      'Quick Play ban rate is not applicable, including when upstream sends zero.',
      'Patch tags are nonexclusive. Their official source date is separate from the statistics date.',
      'Missing catalog IDs must remain in the leaderboard with a neutral fallback portrait.',
    ],
    failures,
    assets: [
      ...heroes.flatMap(hero => [
        { heroId: hero.id, kind: 'portrait', url: hero.avatarUrl, sourcePage: PAGE },
        ...(hero.artUrl ? [{ heroId: hero.id, kind: 'hero-art', url: hero.artUrl, sourcePage: PAGE }] : []),
      ]),
      ...[assets.masthead, ...Object.values(assets.roleIcons), ...Object.values(assets.patchIcons)].map(url => ({ kind: 'official-ui', url: officialAssetUrl(url), sourcePage: PAGE })),
    ].map(asset => ({ ...asset, observedAt: fetchedAt, version: new URL(asset.url).pathname.split('/').pop(), cacheLocation: null })),
  })
  const previous = `${destination}.previous-${process.pid}`
  let movedPrevious = false
  try {
    await rename(destination, previous)
    movedPrevious = true
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  try {
    await rename(staging, destination)
  } catch (error) {
    if (movedPrevious) await rename(previous, destination)
    throw error
  }
  if (movedPrevious) await rm(previous, { recursive: true, force: true })
  console.log(`Published ${available.length} validated public snapshots and ${heroes.length} official hero portraits.`)
} finally {
  await rm(staging, { recursive: true, force: true })
}

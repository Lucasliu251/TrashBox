import { parseOwCatalog, parseOwHeroes, parseOwIndex, parseOwLeaderboard, parseOwStatsSnapshot } from './types'
import type { OwCatalog, OwHomeData, OwSelection, OwStatsResult } from './types'

const PUBLIC_API = 'https://webapi.blizzard.cn/ow-armory-server/'
const DATA_BASE = `${import.meta.env.BASE_URL}ow-data/`
let snapshotCatalogCache: OwCatalog | undefined
let lastSuccessfulLiveCatalog: OwCatalog | undefined
const lastSuccessfulLiveStats = new Map<string, OwStatsResult>()

function historicalCatalog(catalog: OwCatalog, liveError?: string): OwCatalog {
  return {
    ...catalog, source: 'snapshot', heroesSource: 'snapshot', checkedAt: new Date().toISOString(), liveError,
  }
}

/** Only a fixed same-origin public adapter path is configurable; no arbitrary URL proxy. */
function liveBase(): string | undefined {
  const configured: unknown = import.meta.env.VITE_OW_LIVE_BASE
  if (typeof configured === 'string' && configured.trim()) {
    const base = configured.trim().replace(/\/+$/, '')
    if (/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(base)) return base
    return undefined
  }
  // Vite supplies this fixed adapter locally; production needs its equivalent.
  // An absent production adapter returns an honest fallback rather than fake live data.
  return '/ow-live'
}

async function readJson(url: string, signal?: AbortSignal, fresh = false): Promise<unknown> {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  let timedOut = false
  const timer = globalThis.setTimeout(() => { timedOut = true; controller.abort() }, 8000)
  try {
    const response = await fetch(url, {
      signal: controller.signal, credentials: 'omit',
      ...(fresh ? { cache: 'no-store' as const } : {}),
    })
    if (!response.ok) throw new Error(`数据请求失败（HTTP ${response.status}）`)
    return await response.json()
  } catch (error) {
    if (timedOut && !signal?.aborted) throw new Error('数据加载超时，请重试')
    throw error
  } finally {
    globalThis.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

async function loadSnapshotCatalog(signal?: AbortSignal): Promise<OwCatalog> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  if (snapshotCatalogCache) return snapshotCatalogCache
  const catalog = parseOwCatalog(await readJson(`${DATA_BASE}catalog.json`, signal))
  snapshotCatalogCache = catalog
  return catalog
}

/** Fetch the latest publicly advertised patch tags and season on each check. */
export async function loadOwCatalog(
  signal?: AbortSignal,
  options: { preferLive?: boolean } = {},
): Promise<OwCatalog> {
  const captured = await loadSnapshotCatalog(signal)
  const preferLive = options.preferLive !== false
  const base = liveBase()
  if (!preferLive || !base) {
    return historicalCatalog(lastSuccessfulLiveCatalog ?? captured,
      preferLive ? '当前环境尚未连接官网刷新服务，正在展示已采集数据' : undefined)
  }
  try {
    const index = parseOwIndex(await readJson(`${base}/index`, signal, true))
    const fetchedAt = new Date().toISOString()
    const lastKnown = lastSuccessfulLiveCatalog ?? captured
    let heroes = lastKnown.heroes
    let heroesSource: 'live' | 'snapshot' = 'snapshot'
    let heroesFetchedAt = lastKnown.heroesFetchedAt ?? lastKnown.fetchedAt
    let liveError: string | undefined
    try {
      // The index-provided URL is validated as the official HTTPS asset hostname.
      heroes = parseOwHeroes(await readJson(index.heroSourceUrl, signal, true))
      heroesSource = 'live'
      heroesFetchedAt = new Date().toISOString()
    } catch (error) {
      if (signal?.aborted) throw error
      liveError = '官网调整标签已更新；英雄头像资料刷新暂不可用，使用已采集素材'
    }
    const catalog: OwCatalog = {
      ...captured, source: 'live', fetchedAt, checkedAt: new Date().toISOString(),
      heroSourceUrl: index.heroSourceUrl, heroes, heroesSource, heroesFetchedAt,
      patch: index.patch, seasons: index.seasons, currentSeasonId: index.seasons[0]!.id,
      liveError,
    }
    lastSuccessfulLiveCatalog = catalog
    return catalog
  } catch (error) {
    if (signal?.aborted) throw error
    return historicalCatalog(lastSuccessfulLiveCatalog ?? captured,
      '官网调整标签刷新暂不可用，正在展示最近成功获取的标签与赛季信息')
  }
}

function sameSelection(first: OwSelection, second: OwSelection): boolean {
  return first.mode === second.mode && first.seasonId === second.seasonId && first.rankId === second.rankId
}

function selectionKey(selected: OwSelection): string {
  return `${selected.mode}/${selected.seasonId}/${selected.rankId}`
}

/** Public aggregates only. No BattleTag, authentication, or user records are accepted. */
export async function loadOwStats(
  selected: OwSelection,
  options: { signal?: AbortSignal; preferLive?: boolean; catalog?: OwCatalog } = {},
): Promise<OwStatsResult> {
  const captured = await loadSnapshotCatalog(options.signal)
  const catalog = options.catalog ?? await loadOwCatalog(options.signal, { preferLive: options.preferLive })
  const entry = captured.available.find(item => sameSelection(item, selected))
  const key = selectionKey(selected)
  const lastKnownStats = lastSuccessfulLiveStats.get(key)
  const trustedSeasonAdvertised = catalog.seasons.some(item => item.id === selected.seasonId)
    && (catalog.source === 'live' || lastSuccessfulLiveCatalog?.seasons.some(item => item.id === selected.seasonId))
  const modeKnown = catalog.modes.some(item => item.id === selected.mode)
  const rankKnown = catalog.ranks.some(item => item.id === selected.rankId)
  if (!modeKnown || !rankKnown || (!entry && !trustedSeasonAdvertised && !lastKnownStats)) {
    throw new Error('这个筛选组合暂无已验证数据，请选择其他条件')
  }
  const query = new URLSearchParams({ game_mode: selected.mode, season: selected.seasonId, mmr: selected.rankId })
  const sourceUrl = `${PUBLIC_API}hero_leaderboard?${query}`
  const preferLive = options.preferLive !== false
  const base = liveBase()
  let liveError: string | undefined
  if (preferLive && base) {
    try {
      const payload = await readJson(`${base}/hero_leaderboard?${query}`, options.signal, true)
      const rows = parseOwLeaderboard(payload, selected.mode)
      const result: OwStatsResult = { rows, source: 'live', date: rows[0]!.date, fetchedAt: new Date().toISOString(), sourceUrl, selection: { ...selected } }
      lastSuccessfulLiveStats.delete(key)
      lastSuccessfulLiveStats.set(key, result)
      // Keep a small per-selection history for retries without collecting player data.
      if (lastSuccessfulLiveStats.size > 16) lastSuccessfulLiveStats.delete(lastSuccessfulLiveStats.keys().next().value!)
      return result
    } catch (error) {
      if (options.signal?.aborted) throw error
      liveError = '官网统计刷新暂不可用，正在展示相同筛选条件的已采集数据'
    }
  } else if (preferLive) {
    liveError = '当前环境尚未连接官网刷新服务，正在展示已采集数据'
  }
  if (lastKnownStats) {
    return {
      ...lastKnownStats, source: 'snapshot',
      liveError: liveError ? '官网统计刷新暂不可用，正在展示相同筛选条件的最近成功数据' : undefined,
    }
  }
  if (!entry) {
    throw new Error('官网当前赛季统计暂不可用，且没有该赛季的已采集数据，请稍后重试')
  }
  const snapshot = parseOwStatsSnapshot(await readJson(`${DATA_BASE}${entry.file}`, options.signal))
  if (!sameSelection(snapshot.selection, selected)) throw new Error('快照筛选与请求不一致')
  return { ...snapshot, source: 'snapshot', liveError }
}

/** A single refresh follows the freshly loaded season; callers can publish it atomically. */
export async function loadOwHomeData(
  options: { signal?: AbortSignal; preferLive?: boolean } = {},
): Promise<OwHomeData> {
  const catalog = await loadOwCatalog(options.signal, { preferLive: options.preferLive })
  let stats: OwStatsResult | null = null
  let statsError: string | undefined
  try {
    stats = await loadOwStats({ mode: 'jingji', seasonId: catalog.currentSeasonId, rankId: '-127' }, { ...options, catalog })
  } catch (error) {
    if (options.signal?.aborted) throw error
    statsError = error instanceof Error ? error.message : '官网当前赛季统计暂不可用，请稍后重试'
  }
  return { catalog, stats, statsError, checkedAt: new Date().toISOString() }
}

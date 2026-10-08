export type OwMode = 'jingji' | 'kuaisu'
export type OwRole = '1' | '2' | '3'
export type OwPatchTag = 'enhances' | 'weakens' | 'adjusts'

export interface OwHero {
  id: string
  name: string
  avatarUrl: string
  artUrl: string
  description: string
  catalogRole: OwRole | null
  isNew: boolean
}

export interface OwHeroStat {
  heroId: string
  role: OwRole
  winRate: number | null
  pickRate: number | null
  banRate: number | null
  kda: number | null
  date: string
}

export interface OwSelection {
  mode: OwMode
  seasonId: string
  rankId: string
}

export interface OwSnapshotEntry extends OwSelection {
  file: string
  date: string
  fetchedAt: string
}

export interface OwCatalog {
  schemaVersion: 1
  fetchedAt: string
  sourceUrl: string
  heroSourceUrl: string
  heroes: OwHero[]
  patch: { date: string; enhances: string[]; weakens: string[]; adjusts: string[] }
  seasons: { id: string; name: string; description: string }[]
  currentSeasonId: string
  modes: { id: OwMode; name: string }[]
  ranks: { id: string; name: string }[]
  available: OwSnapshotEntry[]
  assets: {
    masthead: string
    roleIcons: Record<OwRole, string>
    patchIcons: Record<OwPatchTag, string>
  }
  qualityIssues: { heroId: string; catalogRole: OwRole | null; statsRole: OwRole }[]
  /** Metadata provenance. A successful check does not change the official patch date. */
  source?: 'snapshot' | 'live'
  checkedAt?: string
  heroesSource?: 'snapshot' | 'live'
  heroesFetchedAt?: string
  liveError?: string
}

export interface OwHomeData {
  catalog: OwCatalog
  /** Never substitute another season when the requested current season is unavailable. */
  stats: OwStatsResult | null
  statsError?: string
  checkedAt: string
}

export interface OwStatsResult {
  rows: OwHeroStat[]
  source: 'snapshot' | 'live'
  date: string
  fetchedAt: string
  sourceUrl: string
  selection: OwSelection
  liveError?: string
}

export interface OwStatsSnapshot {
  schemaVersion: 1
  fetchedAt: string
  sourceUrl: string
  selection: OwSelection
  date: string
  rows: OwHeroStat[]
}

export interface OwIndex {
  heroSourceUrl: string
  patch: OwCatalog['patch']
  seasons: OwCatalog['seasons']
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 结构异常`)
  return value as Record<string, unknown>
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 缺失`)
  return value
}

function list(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} 不是列表`)
  return value
}

function unique(values: string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${name} 包含重复 ID`)
}

export function officialAssetUrl(value: unknown): string {
  const url = new URL(string(value, '官方素材 URL'))
  if (url.protocol !== 'https:' || url.hostname !== 'ld5.res.netease.com' || url.username || url.password) {
    throw new Error('官方素材域名异常')
  }
  return url.href
}

function role(value: unknown): OwRole {
  if (value !== '1' && value !== '2' && value !== '3') throw new Error('英雄职责异常')
  return value
}

function metric(value: unknown, name: string, percentage = false): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (percentage && value > 100)) {
    throw new Error(`${name} 数值异常`)
  }
  return value
}

function date(value: unknown): string {
  const result = string(value, '统计日期')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !isCalendarDate(result)) throw new Error('统计日期异常')
  return result
}

function isCalendarDate(value: string): boolean {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

function patchDate(value: unknown): string {
  const result = string(value, '标签日期')
  if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(result)) throw new Error('标签日期异常')
  const normalized = result.split('/').map(part => part.padStart(2, '0')).join('-')
  if (!isCalendarDate(normalized)) throw new Error('标签日期异常')
  return result
}

function timestamp(value: unknown): string {
  const result = string(value, '采集时间')
  if (Number.isNaN(Date.parse(result))) throw new Error('采集时间异常')
  return result
}

function envelope(value: unknown): unknown {
  const response = object(value, '官方响应')
  if (response.code !== 0) throw new Error(`官方数据暂不可用（${String(response.code)}）`)
  return response.data
}

export function parseOwIndex(value: unknown): OwIndex {
  const data = object(envelope(value), '官网初始化')
  const patch = object(data.patch_desc, '调整标签')
  const officialPatchDate = patchDate(patch.date)
  const ids = (tag: OwPatchTag) => {
    const values = list(patch[tag], tag).map(value => string(value, '标签英雄 ID'))
    unique(values, tag)
    return values
  }
  const seasons = list(data.seasons, '赛季').map(value => {
    const item = object(value, '赛季')
    return { id: string(item.id, '赛季 ID'), name: string(item.name, '赛季名称'), description: typeof item.desc === 'string' ? item.desc : '' }
  })
  if (!seasons.length) throw new Error('官方未提供赛季')
  unique(seasons.map(item => item.id), '赛季')
  return {
    heroSourceUrl: officialAssetUrl(data.hero_configs),
    patch: { date: officialPatchDate, enhances: ids('enhances'), weakens: ids('weakens'), adjusts: ids('adjusts') },
    seasons,
  }
}

export function parseOwHeroes(value: unknown): OwHero[] {
  const data = object(value, '英雄配置')
  const heroes = list(data.heroConfigs, '英雄配置').map(value => {
    const hero = object(value, '英雄')
    const roles: Record<string, OwRole> = { Damage: '1', Tank: '2', Support: '3' }
    const pictures = Array.isArray(hero.picList) ? hero.picList : []
    return {
      id: string(hero.id, '英雄 ID'), name: string(hero.name, '英雄名称'),
      avatarUrl: officialAssetUrl(hero.headSrc),
      artUrl: pictures.length ? officialAssetUrl(pictures[0]) : '',
      // This basic data demo does not ingest the official narrative biographies.
      description: '',
      catalogRole: typeof hero.type === 'string' ? roles[hero.type] ?? null : null,
      isNew: hero.isNew === true,
    }
  })
  if (!heroes.length) throw new Error('英雄配置为空')
  unique(heroes.map(hero => hero.id), '英雄配置')
  return heroes
}

function validateStatsRows(rows: OwHeroStat[]): OwHeroStat[] {
  if (!rows.length) throw new Error('官方榜单暂无数据')
  unique(rows.map(row => row.heroId), '英雄榜单')
  if (new Set(rows.map(row => row.date)).size !== 1) throw new Error('统计批次日期不一致')
  return rows
}

export function parseOwLeaderboard(value: unknown, mode: OwMode): OwHeroStat[] {
  return validateStatsRows(list(envelope(value), '英雄榜单').map(value => {
    const row = object(value, '统计行')
    return {
      heroId: string(row.hero_id, '英雄 ID'), role: role(row.hero_type),
      winRate: metric(row.win_ratio, '胜率', true), pickRate: metric(row.selection_ratio, '选取率', true),
      // The official client does not expose hero bans for Quick Play.
      banRate: mode === 'jingji' ? metric(row.ban_ratio, '禁用率', true) : null,
      kda: metric(row.kda, 'KDA'), date: date(row.ds),
    }
  }))
}

function selection(value: unknown): OwSelection {
  const item = object(value, '榜单筛选')
  if (item.mode !== 'jingji' && item.mode !== 'kuaisu') throw new Error('不支持的比赛模式')
  return { mode: item.mode, seasonId: string(item.seasonId, '赛季 ID'), rankId: string(item.rankId, '段位 ID') }
}

export function parseOwStatsSnapshot(value: unknown): OwStatsSnapshot {
  const data = object(value, '榜单快照')
  if (data.schemaVersion !== 1) throw new Error('榜单快照版本异常')
  const selected = selection(data.selection)
  const rows = validateStatsRows(list(data.rows, '快照统计行').map(value => {
    const row = object(value, '快照统计行')
    return {
      heroId: string(row.heroId, '英雄 ID'), role: role(row.role),
      winRate: metric(row.winRate, '胜率', true), pickRate: metric(row.pickRate, '选取率', true),
      banRate: selected.mode === 'jingji' ? metric(row.banRate, '禁用率', true) : null,
      kda: metric(row.kda, 'KDA'), date: date(row.date),
    }
  }))
  const batchDate = date(data.date)
  if (rows[0]?.date !== batchDate) throw new Error('快照日期与统计行不一致')
  const sourceUrl = string(data.sourceUrl, '统计来源')
  const source = new URL(sourceUrl)
  if (source.origin !== 'https://webapi.blizzard.cn' || source.pathname !== '/ow-armory-server/hero_leaderboard') throw new Error('统计来源异常')
  if (source.searchParams.get('game_mode') !== selected.mode || source.searchParams.get('season') !== selected.seasonId || source.searchParams.get('mmr') !== selected.rankId) {
    throw new Error('快照统计来源与筛选不一致')
  }
  return { schemaVersion: 1, fetchedAt: timestamp(data.fetchedAt), sourceUrl, selection: selected, date: batchDate, rows }
}

export function parseOwCatalog(value: unknown): OwCatalog {
  const data = object(value, 'OW 目录')
  if (data.schemaVersion !== 1) throw new Error('目录版本异常')
  const heroes = list(data.heroes, '英雄目录').map(value => {
    const hero = object(value, '英雄目录')
    return {
      id: string(hero.id, '英雄 ID'), name: string(hero.name, '英雄名称'), avatarUrl: officialAssetUrl(hero.avatarUrl),
      artUrl: hero.artUrl ? officialAssetUrl(hero.artUrl) : '', description: typeof hero.description === 'string' ? hero.description : '',
      catalogRole: hero.catalogRole === null ? null : role(hero.catalogRole), isNew: hero.isNew === true,
    }
  })
  if (!heroes.length) throw new Error('英雄目录为空')
  unique(heroes.map(hero => hero.id), '英雄目录')
  const seasons = list(data.seasons, '赛季目录').map(value => {
    const item = object(value, '赛季')
    return { id: string(item.id, '赛季 ID'), name: string(item.name, '赛季名称'), description: typeof item.description === 'string' ? item.description : '' }
  })
  unique(seasons.map(item => item.id), '赛季目录')
  const currentSeasonId = string(data.currentSeasonId, '当前赛季')
  if (!seasons.some(item => item.id === currentSeasonId)) throw new Error('当前赛季未收录')
  const modes = list(data.modes, '模式目录').map(value => {
    const item = object(value, '模式')
    if (item.id !== 'jingji' && item.id !== 'kuaisu') throw new Error('模式目录异常')
    return { id: item.id as OwMode, name: string(item.name, '模式名称') }
  })
  const ranks = list(data.ranks, '段位目录').map(value => {
    const item = object(value, '段位')
    return { id: string(item.id, '段位 ID'), name: string(item.name, '段位名称') }
  })
  unique(modes.map(item => item.id), '模式目录')
  unique(ranks.map(item => item.id), '段位目录')
  const available = list(data.available, '可用筛选').map(value => {
    const item = object(value, '快照选项')
    const selected = selection(item)
    if (!seasons.some(season => season.id === selected.seasonId) || !modes.some(mode => mode.id === selected.mode) || !ranks.some(rank => rank.id === selected.rankId)) {
      throw new Error('快照选项缺少对应目录')
    }
    const file = string(item.file, '快照文件')
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(file)) throw new Error('快照路径异常')
    return { ...selected, file, date: date(item.date), fetchedAt: timestamp(item.fetchedAt) }
  })
  if (!available.length) throw new Error('没有可用的公开榜单')
  unique(available.map(item => `${item.mode}/${item.seasonId}/${item.rankId}`), '快照选项')
  const patch = object(data.patch, '调整标签')
  const patchIds = (tag: OwPatchTag) => {
    const ids = list(patch[tag], tag).map(value => string(value, '调整英雄'))
    unique(ids, tag)
    return ids
  }
  const assets = object(data.assets, '素材目录')
  const roleIcons = object(assets.roleIcons, '职责图标')
  const patchIcons = object(assets.patchIcons, '调整图标')
  const qualityIssues = list(data.qualityIssues, '质量记录').map(value => {
    const issue = object(value, '职责冲突')
    return { heroId: string(issue.heroId, '英雄 ID'), catalogRole: issue.catalogRole === null ? null : role(issue.catalogRole), statsRole: role(issue.statsRole) }
  })
  const officialPatchDate = patchDate(patch.date)
  if (data.sourceUrl !== 'https://webapi.blizzard.cn/ow-armory-server/index') throw new Error('目录来源异常')
  return {
    schemaVersion: 1, fetchedAt: timestamp(data.fetchedAt), sourceUrl: data.sourceUrl,
    heroSourceUrl: officialAssetUrl(data.heroSourceUrl), heroes,
    patch: { date: officialPatchDate, enhances: patchIds('enhances'), weakens: patchIds('weakens'), adjusts: patchIds('adjusts') },
    seasons, currentSeasonId, modes, ranks, available, qualityIssues,
    assets: {
      masthead: officialAssetUrl(assets.masthead),
      roleIcons: { '1': officialAssetUrl(roleIcons['1']), '2': officialAssetUrl(roleIcons['2']), '3': officialAssetUrl(roleIcons['3']) },
      patchIcons: { enhances: officialAssetUrl(patchIcons.enhances), weakens: officialAssetUrl(patchIcons.weakens), adjusts: officialAssetUrl(patchIcons.adjusts) },
    },
  }
}

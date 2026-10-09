import type { OwHero, OwHeroStat, OwRole } from './types'
import { COUNTER_ROWS, COUNTER_PENDING_REWORK, counterSourceUrl } from './tactics-counter-table'
import { MECHANICS, ROLE_LIMITS, ROLE_NAMES } from './tactics-data'

export interface TacticalHero extends OwHero { role: OwRole | null; assessed: boolean }
export interface RelationReason { id: string; reason: string; condition: string; sourceIds: string[]; weight: number }
export interface Matchup { from: string; to: string; weight: number; rating: number; sourceUrls: string[]; reasons: RelationReason[] }
export interface TeamSuggestion {
  ids: string[]; score: number; counterScore: number; synergyScore: number
  coverage: string[]; unknownEnemies: string[]; explanations: string[]
}
export function tacticalRoster(heroes: OwHero[], stats: OwHeroStat[] = []): TacticalHero[] {
  const roles = new Map(stats.map(row => [row.heroId, row.role]))
  return heroes.map(hero => ({ ...hero, role: hero.catalogRole ?? MECHANICS[hero.id]?.role ?? roles.get(hero.id) ?? null,
    assessed: !!COUNTER_ROWS[hero.id] && !COUNTER_PENDING_REWORK.has(hero.id) }))
}
const normalize = (value: string) => value.toLocaleLowerCase().replace(/[\s：:._-]/g, '')
export function matchesHero(hero: OwHero, query: string): boolean {
  const needle = normalize(query.trim())
  return !needle || [hero.name, hero.id, ...(MECHANICS[hero.id]?.aliases || [])].some(value => normalize(value).includes(needle))
}
export function parseHeroList(roster: TacticalHero[], text: string): { ids: string[]; issues: string[] } {
  const names = text.split(/[,，;；\n]+/).map(value => value.trim()).filter(Boolean)
  const ids: string[] = [], issues: string[] = []
  if (names.length > 5) return { ids, issues: ['最多输入五位英雄。'] }
  for (const name of names) {
    const exact = roster.filter(hero => [hero.name, hero.id, ...(MECHANICS[hero.id]?.aliases || [])].some(value => normalize(value) === normalize(name)))
    const options = exact.length ? exact : roster.filter(hero => matchesHero(hero, name))
    if (options.length !== 1) { issues.push(options.length ? `“${name}”匹配多位英雄，请补全名称。` : `未找到“${name}”。`); continue }
    const id = options[0]!.id
    if (ids.includes(id)) issues.push(`“${options[0]!.name}”重复。`)
    else ids.push(id)
  }
  return { ids, issues }
}
/** Source rates the opposing hero on a 1–10 scale; >5 favors that opponent.
 * Mirror observations are deduplicated, never counted as independent evidence.
 * The shown snapshot omits neutral/hidden pairs: no invented edges or prose.
 */
export function matchups(heroes: TacticalHero[]): Matchup[] {
  const known = new Set(heroes.filter(hero => hero.assessed).map(hero => hero.id)), result = new Map<string, Matchup>()
  for (const [subject, rows] of Object.entries(COUNTER_ROWS)) for (const [other, raw] of rows) {
    if (!known.has(subject) || !known.has(other) || subject === other || raw === 5) continue
    const from = raw > 5 ? other : subject, to = raw > 5 ? subject : other
    const rating = raw > 5 ? raw : 10 - raw, key = `${from}:${to}`
    const existing = result.get(key), url = counterSourceUrl(subject)
    if (existing) { if (!existing.sourceUrls.includes(url)) existing.sourceUrls.push(url); continue }
    result.set(key, { from, to, rating, weight: rating - 5, sourceUrls: [url], reasons: [{
      id: key, weight: rating - 5, sourceIds: ['counterpickgg'],
      reason: `社区表中该对抗方向获评 ${rating}/10。`,
      condition: '社区参考评分；地图、熟练度及队友配合会改变实际表现。',
    }] })
  }
  return [...result.values()]
}
export function validateTeams(roster: TacticalHero[], enemies: string[], locked: string[]): string[] {
  const issues: string[] = [], byId = new Map(roster.map(hero => [hero.id, hero]))
  for (const [label, list] of [['敌方', enemies], ['己方', locked]] as const) {
    if (list.length > 5) issues.push(`${label}最多选择五位英雄。`)
    if (new Set(list).size !== list.length) issues.push(`${label}不能重复选择同一位英雄。`)
    if (list.some(id => !byId.has(id))) issues.push(`${label}包含目录中不存在的英雄，请重新选择。`)
  }
  for (const role of ['2', '1', '3'] as OwRole[]) {
    if (locked.filter(id => byId.get(id)?.role === role).length > ROLE_LIMITS[role]) issues.push(`己方${ROLE_NAMES[role]}超出 5v5 职责队列名额。`)
  }
  if (locked.some(id => byId.has(id) && !byId.get(id)!.role)) issues.push('己方有职责尚未确认的英雄，无法可靠补齐职责队列。')
  return issues
}
function combinations(ids: string[], size: number): string[][] {
  if (size === 0) return [[]]
  if (size > ids.length) return []
  const results: string[][] = []
  function visit(start: number, chosen: string[]) {
    if (chosen.length === size) { results.push([...chosen]); return }
    for (let index = start; index <= ids.length - (size - chosen.length); index++) { chosen.push(ids[index]!); visit(index + 1, chosen); chosen.pop() }
  }
  visit(0, [])
  return results
}
/** Exhaustively scores the supported 1/2/2 completions, never replacing locked picks. */
export function recommendTeams(roster: TacticalHero[], enemies: string[], locked: string[], limit = 3): TeamSuggestion[] {
  if (limit <= 0 || validateTeams(roster, enemies, locked).length || (!enemies.length && !locked.length)) return []
  const byId = new Map(roster.map(hero => [hero.id, hero])), edges = matchups(roster)
  const lookup = new Map(edges.map(edge => [`${edge.from}:${edge.to}`, edge]))
  const individual = new Map(roster.map(hero => [hero.id, enemies.reduce((sum, enemy) =>
    sum + (lookup.get(`${hero.id}:${enemy}`)?.weight ?? 0) - .6 * (lookup.get(`${enemy}:${hero.id}`)?.weight ?? 0), 0)]))
  const slots = (['2', '1', '3'] as OwRole[]).map(role => {
    const existing = locked.filter(id => byId.get(id)?.role === role)
    const candidates = roster.filter(hero => hero.role === role && hero.assessed && !locked.includes(hero.id))
      .map(hero => hero.id).sort((a, b) => (individual.get(b)! - individual.get(a)!) || a.localeCompare(b))
    return combinations(candidates, ROLE_LIMITS[role] - existing.length).map(extra => [...existing, ...extra])
  })
  const top: TeamSuggestion[] = []
  for (const tank of slots[0]!) for (const damage of slots[1]!) for (const support of slots[2]!) {
    const ids = [...tank, ...damage, ...support]
    let synergyScore = 0
    const styles = ids.map(id => MECHANICS[id]?.style)
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (styles[i] && styles[i] === styles[j]) synergyScore += .15
    const frontline = tank[0] ? MECHANICS[tank[0]] : undefined
    if (frontline?.style === 'brawl' && support.some(id => MECHANICS[id]?.tags.includes('speed'))) synergyScore += .7
    if (ids.some(id => MECHANICS[id]?.tags.includes('air')) && support.some(id => MECHANICS[id]?.tags.includes('boost'))) synergyScore += .5
    const coverage = enemies.filter(enemy => ids.some(id => lookup.has(`${id}:${enemy}`)))
    // Diminishing returns: five heroes targeting one enemy must not outscore covering several threats.
    const responses = enemies.reduce((sum, enemy) => {
      const values = ids.map(id => lookup.get(`${id}:${enemy}`)?.weight ?? 0).sort((a, b) => b - a)
      return sum + (values[0] ?? 0) + .15 * (values[1] ?? 0)
    }, 0)
    const exposure = ids.reduce((sum, id) => sum + Math.max(0, ...enemies.map(enemy => lookup.get(`${enemy}:${id}`)?.weight ?? 0)), 0)
    const counterScore = responses - exposure * .18
    const score = counterScore + synergyScore + coverage.length * .7
    const suggestion: TeamSuggestion = { ids, score: Math.round(score * 10) / 10, counterScore, synergyScore,
      coverage, unknownEnemies: enemies.filter(enemy => !byId.get(enemy)?.assessed), explanations: [] }
    top.push(suggestion)
    top.sort((a, b) => b.score - a.score || a.ids.join(',').localeCompare(b.ids.join(',')))
    // Keep a diverse shortlist while remaining bounded in memory.
    if (top.length > 40) top.length = 40
  }
  const selected: TeamSuggestion[] = []
  for (const team of top) {
    if (selected.some(previous => team.ids.filter(id => !previous.ids.includes(id)).length < Math.min(2, 5 - locked.length)) && selected.length) continue
    for (const enemy of enemies) {
      const best = team.ids.map(id => lookup.get(`${id}:${enemy}`)).filter((value): value is Matchup => !!value).sort((a, b) => b.weight - a.weight)[0]
      if (best) team.explanations.push(`${byId.get(best.from)!.name} → ${byId.get(enemy)!.name}：${best.reasons[0]!.reason}`)
    }
    if (team.synergyScore > 0) team.explanations.push('阵容加入了交战距离 / 机动节奏的配合；需实际沟通和站位。')
    selected.push(team)
    if (selected.length === limit) break
  }
  return selected
}

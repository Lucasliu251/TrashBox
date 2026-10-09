<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import type { OwHero, OwHeroStat, OwRole } from './types'
import { tacticalRoster, matchups, recommendTeams, validateTeams, parseHeroList } from './tactics'
import type { Matchup, TeamSuggestion } from './tactics'
import { ROLE_LIMITS, ROLE_NAMES, TACTICS_VERSION, TACTIC_SOURCES } from './tactics-data'
import { counterSourceUrl } from './tactics-counter-table'
import OwPortrait from './OwPortrait.vue'
import OwHeroPicker from './OwHeroPicker.vue'
import './tactics.css'

const props = defineProps<{ heroes: OwHero[]; stats: OwHeroStat[] }>()
const markerId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
const activeHero = ref('dva')
const graphMode = ref<'focused' | 'all'>('focused')
const searching = ref(false)
const roster = computed(() => tacticalRoster(props.heroes, props.stats))
const byId = computed(() => new Map(roster.value.map(hero => [hero.id, hero])))
const focused = computed(() => byId.value.get(activeHero.value))
const edges = computed(() => matchups(roster.value))
const incoming = computed(() => edges.value.filter(edge => edge.to === activeHero.value).sort((a, b) => b.weight - a.weight))
const outgoing = computed(() => edges.value.filter(edge => edge.from === activeHero.value).sort((a, b) => b.weight - a.weight))
const visibleEdges = computed(() => graphMode.value === 'all' ? edges.value : edges.value.filter(edge => edge.from === activeHero.value || edge.to === activeHero.value))
const connected = computed(() => new Set([activeHero.value, ...incoming.value.map(edge => edge.from), ...outgoing.value.map(edge => edge.to)]))
const assessedCount = computed(() => roster.value.filter(hero => hero.assessed).length)
const nodeOrder = computed(() => [...roster.value].sort((a, b) => String(a.role).localeCompare(String(b.role)) || a.id.localeCompare(b.id)))
const nodes = computed(() => nodeOrder.value.map((hero, index) => {
  const angle = index / nodeOrder.value.length * Math.PI * 2 - Math.PI / 2
  return { ...hero, x: 450 + Math.cos(angle) * 330, y: 450 + Math.sin(angle) * 330, anchor: Math.cos(angle) < -.1 ? 'end' : Math.cos(angle) > .1 ? 'start' : 'middle' }
}))
const positions = computed(() => new Map(nodes.value.map(node => [node.id, node])))
function edgePath(edge: Matchup) {
  const from = positions.value.get(edge.from)!, to = positions.value.get(edge.to)!
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy)
  return `M ${from.x + dx / length * 19} ${from.y + dy / length * 19} Q ${(from.x + to.x) / 2 - dy / length * 20} ${(from.y + to.y) / 2 + dx / length * 20} ${to.x - dx / length * 23} ${to.y - dy / length * 23}`
}
const name = (id: string) => byId.value.get(id)?.name || id
function selectFocus(id: string) { activeHero.value = id; searching.value = false }
watch(roster, heroes => { if (!heroes.some(hero => hero.id === activeHero.value) && heroes[0]) activeHero.value = heroes[0].id }, { immediate: true })

const enemies = ref<string[]>([])
const locked = ref<string[]>([])
const choosing = ref<'enemy' | 'own' | null>(null)
const suggestions = ref<TeamSuggestion[]>([])
const computing = ref(false)
const submitted = ref(false)
const bulkText = ref('')
const bulkIssues = ref<string[]>([])
const selectionIssues = computed(() => validateTeams(roster.value, enemies.value, locked.value))
const missingRoles = computed(() => (['2', '1', '3'] as OwRole[]).map(role => ({ role, count: ROLE_LIMITS[role] - locked.value.filter(id => byId.value.get(id)?.role === role).length })))
const unknownInputs = computed(() => [...new Set([...enemies.value, ...locked.value])].filter(id => !byId.value.get(id)?.assessed))
watch([enemies, locked], () => { suggestions.value = []; submitted.value = false }, { deep: true })
function pickTeam(id: string) {
  const target = choosing.value === 'enemy' ? enemies : locked
  if (target.value.length >= 5 || target.value.includes(id)) return
  target.value = [...target.value, id]
  if (target.value.length === 5) choosing.value = null
}
function remove(team: 'enemy' | 'own', id: string) {
  const target = team === 'enemy' ? enemies : locked
  target.value = target.value.filter(value => value !== id)
}
async function calculate() {
  if (computing.value || selectionIssues.value.length || (!enemies.value.length && !locked.value.length)) return
  computing.value = true
  const opponent = [...enemies.value], own = [...locked.value]
  await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
  try {
    const result = recommendTeams(roster.value, opponent, own)
    if (opponent.join() === enemies.value.join() && own.join() === locked.value.join()) { suggestions.value = result; submitted.value = true }
  } finally { computing.value = false }
}
function example() { enemies.value = ['winston', 'genji', 'pharah', 'ana', 'mercy'].filter(id => byId.value.has(id)); locked.value = [] }
function applyBulk() {
  const result = parseHeroList(roster.value, bulkText.value)
  bulkIssues.value = result.issues
  if (result.issues.length || !choosing.value) return
  if (choosing.value === 'enemy') enemies.value = result.ids
  else locked.value = result.ids
  choosing.value = null; bulkText.value = ''; bulkIssues.value = []
}
watch(choosing, () => { bulkText.value = ''; bulkIssues.value = [] })
</script>

<template>
  <section id="ow-tactics" class="ow-tactics" aria-labelledby="ow-tactics-title">
    <header class="tactic-heading"><div><span class="ow-kicker">MATCHUP LAB</span><h2 id="ow-tactics-title">英雄克制 · 阵容实验室</h2><p>看懂交战关系，再决定下一手。</p></div><span class="tactic-version">{{ TACTICS_VERSION }}</span></header>
    <div class="tactic-model-note"><strong>社区克制表</strong><span>来源 CounterPickGG，收录 {{ assessedCount }}/{{ roster.length }} 位英雄、{{ edges.length }} 个有向优势关系。评分不是胜率；这是核对时的快照，源站未公布克制表更新日期。</span></div>

    <div class="tactic-tabs"><button :class="{ selected: graphMode === 'focused' }" :aria-pressed="graphMode === 'focused'" @click="graphMode = 'focused'">所选英雄关系</button><button :class="{ selected: graphMode === 'all' }" :aria-pressed="graphMode === 'all'" @click="graphMode = 'all'">全部已收录关系</button></div>
    <div class="tactic-focus-bar"><div><OwPortrait :src="focused?.avatarUrl" :name="focused?.name || '英雄'" /><span><strong>{{ focused?.name || '加载英雄目录…' }}</strong><small>{{ focused?.assessed ? '点击图中头像切换，也可搜索英雄。' : '该英雄克制数据待收录；不据此判断其强弱。' }}</small></span></div><button class="tactic-button" :aria-expanded="searching" @click="searching = !searching">⌕ 搜索英雄</button></div>
    <OwHeroPicker v-if="searching" :heroes="roster" label="搜索克制关系英雄" @select="selectFocus" />

    <div class="tactic-graph-shell">
      <svg viewBox="0 0 900 900" class="tactic-graph" role="group" aria-label="英雄有向克制关系图：箭头从应对者指向目标">
        <defs><marker :id="markerId + '-arrow'" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
        <circle cx="450" cy="450" r="330" class="tactic-orbit" /><circle cx="450" cy="450" r="220" class="tactic-orbit inner" />
        <path v-for="edge in visibleEdges" :key="edge.from + edge.to" :d="edgePath(edge)" class="tactic-edge" :class="{ incoming: edge.to === activeHero, outgoing: edge.from === activeHero, quiet: graphMode === 'all' && edge.to !== activeHero && edge.from !== activeHero }" :marker-end="`url(#${markerId}-arrow)`"><title>{{ name(edge.from) }} → {{ name(edge.to) }}：{{ edge.reasons[0]?.reason }}</title></path>
        <text x="450" y="426" class="tactic-center-kicker" text-anchor="middle">{{ graphMode === 'all' ? '全部已收录关系' : '当前观察英雄' }}</text><text x="450" y="459" class="tactic-center-name" text-anchor="middle">{{ focused?.name }}</text><text x="450" y="486" class="tactic-center-hint" text-anchor="middle">{{ incoming.length }} 个应对方向 · {{ outgoing.length }} 个针对方向</text>
        <g v-for="node in nodes" :key="node.id" :transform="`translate(${node.x},${node.y})`" class="tactic-node" :class="{ active: node.id === activeHero, dim: graphMode === 'focused' && !connected.has(node.id), unassessed: !node.assessed }" role="button" tabindex="0" :aria-label="'图中选择' + node.name" @click="selectFocus(node.id)" @keydown.enter="selectFocus(node.id)" @keydown.space.prevent="selectFocus(node.id)">
          <circle r="19" :class="'role-' + node.role" /><image v-if="node.avatarUrl" :href="node.avatarUrl" x="-15" y="-15" width="30" height="30" /><text :x="node.anchor === 'end' ? -25 : node.anchor === 'start' ? 25 : 0" :y="node.anchor === 'middle' ? -26 : 4" :text-anchor="node.anchor">{{ node.name }}</text><title>{{ node.assessed ? '已有来源关系' : '克制数据待收录' }}</title>
        </g>
      </svg>
    </div>
    <p v-if="focused?.assessed" class="tactic-fineprint"><a :href="counterSourceUrl(activeHero)" target="_blank" rel="noopener noreferrer">查看 {{ focused.name }} 的原始克制表 ↗</a></p>
    <div class="tactic-legend"><span><i class="incoming" />绿线：谁能应对 {{ focused?.name }}</span><span><i class="outgoing" />橙线：{{ focused?.name }} 可针对谁</span><span>箭头指向目标 · 灰色虚线头像为待收录</span></div>
    <div class="tactic-relations">
      <section><h3>谁能克制 TA <small>{{ incoming.length }}</small></h3><p v-if="!incoming.length" class="tactic-empty">暂无已收录关系；这不代表该英雄没有天敌。</p><div class="tactic-relation-list"><div v-for="edge in incoming" :key="edge.from" class="tactic-relation-entry"><button class="tactic-relation-card" @click="selectFocus(edge.from)"><OwPortrait :src="byId.get(edge.from)?.avatarUrl" :name="name(edge.from)" /><span><strong>{{ name(edge.from) }}</strong><small>{{ edge.reasons[0]?.reason }}</small><em>{{ edge.reasons[0]?.condition }}</em></span><b>↗</b></button><a :href="edge.sourceUrls[0]" target="_blank" rel="noopener noreferrer">评分来源 ↗</a></div></div></section>
      <section><h3>TA 能针对谁 <small>{{ outgoing.length }}</small></h3><p v-if="!outgoing.length" class="tactic-empty">暂无已收录关系，后续可继续补充。</p><div class="tactic-relation-list"><div v-for="edge in outgoing" :key="edge.to" class="tactic-relation-entry"><button class="tactic-relation-card" @click="selectFocus(edge.to)"><OwPortrait :src="byId.get(edge.to)?.avatarUrl" :name="name(edge.to)" /><span><strong>{{ name(edge.to) }}</strong><small>{{ edge.reasons[0]?.reason }}</small><em>{{ edge.reasons[0]?.condition }}</em></span><b>↗</b></button><a :href="edge.sourceUrls[0]" target="_blank" rel="noopener noreferrer">评分来源 ↗</a></div></div></section>
    </div>

    <section class="tactic-builder" aria-labelledby="tactic-builder-title">
      <div class="tactic-builder-heading"><div><span class="ow-kicker">BUILD YOUR FIVE</span><h3 id="tactic-builder-title">输入敌方阵容，补齐你的队伍</h3><p>5v5 职责队列：1 重装 · 2 输出 · 2 支援。己方已选英雄会保留。</p></div><button class="tactic-text-button" @click="example">载入示例阵容</button></div>
      <div class="tactic-team-columns">
        <section v-for="side in (['enemy', 'own'] as const)" :key="side" class="tactic-team" :class="side">
          <h4>{{ side === 'enemy' ? '敌方阵容' : '己方已选 / 锁定' }}<small>{{ (side === 'enemy' ? enemies : locked).length }}/5</small></h4>
          <div class="tactic-slots"><template v-for="id in (side === 'enemy' ? enemies : locked)" :key="id"><div class="tactic-picked"><OwPortrait :src="byId.get(id)?.avatarUrl" :name="name(id)" /><strong>{{ name(id) }}</strong><small>{{ byId.get(id)?.role ? ROLE_NAMES[byId.get(id)!.role!] : '职责待确认' }}</small><button :aria-label="'移除' + (side === 'enemy' ? '敌方' : '己方') + name(id)" @click="remove(side, id)">×</button></div></template><button v-for="index in 5 - (side === 'enemy' ? enemies : locked).length" :key="'empty-' + index" class="tactic-slot-empty" :aria-label="'添加' + (side === 'enemy' ? '敌方' : '己方') + '英雄'" @click="choosing = side"><b>＋</b><span>{{ side === 'enemy' ? '选择英雄' : '待补齐' }}</span></button></div>
        </section>
      </div>
      <section v-if="choosing" class="tactic-team-picker"><div><strong>添加{{ choosing === 'enemy' ? '敌方' : '己方' }}英雄</strong><button class="tactic-text-button" @click="choosing = null">收起</button></div><form class="tactic-bulk" @submit.prevent="applyBulk"><label><span>批量输入，将替换这一侧已选英雄</span><input v-model="bulkText" :aria-label="'批量输入' + (choosing === 'enemy' ? '敌方' : '己方') + '英雄'" placeholder="例：猩猩，源氏，法鸡，安娜，天使" /></label><button class="tactic-button" type="submit" :disabled="!bulkText.trim()">应用名单</button></form><p v-for="issue in bulkIssues" :key="issue" class="tactic-error" role="alert">{{ issue }}</p><OwHeroPicker :heroes="roster" :excluded="choosing === 'enemy' ? enemies : locked" :label="'搜索' + (choosing === 'enemy' ? '敌方' : '己方') + '阵容英雄'" @select="pickTeam" /></section>
      <div class="tactic-builder-actions"><span><template v-for="slot in missingRoles" :key="slot.role">{{ ROLE_NAMES[slot.role] }}还需 {{ Math.max(0, slot.count) }} 位　</template></span><div><button class="tactic-text-button" @click="enemies = []; locked = []; choosing = null">清空阵容</button><button class="tactic-button primary" :disabled="computing || selectionIssues.length > 0 || (!enemies.length && !locked.length)" @click="calculate">{{ computing ? '计算阵容…' : locked.length === 5 ? '评估当前阵容' : '推荐完整阵容' }}</button></div></div>
      <p v-for="issue in selectionIssues" :key="issue" class="tactic-error" role="alert">{{ issue }}</p>
      <p v-if="unknownInputs.length" class="tactic-notice">{{ unknownInputs.map(name).join('、') }} 的克制数据尚未收录：可以保持己方选择并按职责补齐，但不会伪造其克制贡献。</p>
      <p class="tactic-fineprint">评分只比较本次输入下的社区对抗评分，考虑已收录的对抗方向与基础配合。未建模的地图、熟练度、技能冷却、禁用和特定威能仍需自行判断。</p>
      <div v-if="suggestions.length" class="tactic-suggestions" aria-live="polite"><article v-for="(team, index) in suggestions" :key="team.ids.join()" class="tactic-suggestion"><div class="tactic-suggestion-heading"><strong>方案 {{ String(index + 1).padStart(2, '0') }}</strong><span>推荐匹配分 <b>{{ team.score.toFixed(1) }}</b></span></div><div class="tactic-result-roster"><div v-for="id in team.ids" :key="id"><OwPortrait :src="byId.get(id)?.avatarUrl" :name="name(id)" /><strong>{{ name(id) }}</strong><small>{{ locked.includes(id) ? '已锁定' : '推荐补齐' }}</small></div></div><p>{{ team.coverage.length ? '已有社区优势关系覆盖：' + team.coverage.map(name).join('、') : '暂无已收录的直接应对关系，本方案只提供职责与配合建议。' }}</p><ul><li v-for="explanation in team.explanations" :key="explanation">{{ explanation }}</li></ul><small v-if="team.unknownEnemies.length">敌方克制数据待收录：{{ team.unknownEnemies.map(name).join('、') }}</small></article></div>
      <p v-else-if="submitted" class="tactic-empty">当前选择无法形成可评估的 1/2/2 阵容，请调整已选英雄或补充克制数据。</p>
    </section>
    <details class="tactic-sources"><summary>查看来源与数据边界</summary><p>克制方向来自 CounterPickGG 公开英雄表的非中立评分，仅保存数字与来源，不复制攻略正文。原表“被克制”列大于 5 表示对方占优，小于 5 表示本英雄占优；反向重复条目只算一次。未显示或未收录的关系为未知，不能据此视为中立。</p><p>推荐按 5v5 基础职责队列补齐。此表为海外社区参考，不是国服官方对局统计，也未按段位、地图或特殊威能分层。本站使用优势覆盖、被克制风险和少量人工风格配合规则排序，不输出阵容胜率。血律尚未出现在来源表中，黑影与路霸重做前的关系已暂停，等待来源针对新技能复核；源站的统计更新日期不等于克制表更新日期。</p><ul><li v-for="source in TACTIC_SOURCES" :key="source.id"><a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }} ↗</a></li></ul></details>
  </section>
</template>

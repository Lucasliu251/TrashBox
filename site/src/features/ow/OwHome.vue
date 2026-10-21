<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, nextTick } from 'vue'
import { loadOwHomeDataCached, loadOwStats, loadOwBalancePatch, loadOwCatalog } from './api'
import type { OwCatalog, OwHero, OwHeroStat, OwPatchTag, OwRole, OwBalancePatch } from './types'
import OwIcon from './OwIcon.vue'
import BrandIcon from '../../../../shared/components/BrandIcon.vue'
import OwPortrait from './OwPortrait.vue'
import OwTactics from './OwTactics.vue'
import OwMyMatches from './OwMyMatches.vue'
import { officialCnPatchUrl } from './patch-link'
import './ow.css'

type Metric = 'winRate' | 'pickRate' | 'banRate'
type HeroRow = { hero: OwHero; stat: OwHeroStat }
const emit = defineEmits<{ navigate: [] }>()

const officialBoard = 'https://ow.blizzard.cn/herolist/'
const catalog = ref<OwCatalog | null>(null)
const stats = ref<Awaited<ReturnType<typeof loadOwStats>> | null>(null)
const loading = ref(true)
const error = ref('')
const balancePatch = ref<OwBalancePatch | null>(null)
const patchError = ref('')
const activeBanner = ref(0)
type OwView = 'heroes' | 'tactics' | 'matches'
function viewFromUrl(): OwView {
  const view = new URLSearchParams(location.search).get('view')
  return view === 'matches' || view === 'tactics' ? view : 'heroes'
}
const activeView = ref<OwView>(viewFromUrl())
const visitedTactics = ref(activeView.value === 'tactics')
const lifecycleController = new AbortController()
let disposed = false
let inFlight: Promise<void> | null = null

const bannerContent = [
  { id: 'kiriko', title: '版本更新', subtitle: '掌握每次调整', description: '关注技能与数值变化，了解新版本的战场节奏。', action: '查看国服补丁', target: 'patch' },
  { id: 'genji', title: '国服英雄', subtitle: '看清赛季风向', description: '从胜率、出场率与禁用率，发现当前赛季的热门选择。', action: '查看英雄榜', target: 'board' },
  { id: 'dva', title: '英雄克制', subtitle: '找到阵容答案', description: '搜索英雄的应对关系，选好队友，补齐你的五人阵容。', action: '进入克制实验室', target: 'tactics' },
]
const currentBanner = computed(() => bannerContent[activeBanner.value] || bannerContent[0]!)
const heroMap = computed(() => new Map(catalog.value?.heroes.map(hero => [hero.id, hero]) || []))
const bannerHero = computed(() => heroMap.value.get(currentBanner.value.id))
const currentSeason = computed(() => catalog.value?.seasons.find(item => item.id === catalog.value?.currentSeasonId))
const selectionText = computed(() => (currentSeason.value?.name || '当前赛季') + ' · 竞技比赛 · 全部段位')
const allRows = computed<HeroRow[]>(() => stats.value?.rows.map(stat => ({ hero: getHero(stat.heroId), stat })) || [])
const patchDate = computed(() => balancePatch.value?.date || catalog.value?.patch.date || '')
const patchPublisher = computed(() => balancePatch.value?.region === 'global' ? '暴雪国际服 · 官方繁体中文' : balancePatch.value ? '网易国服 · 官方简体中文' : '国服英雄调整')
const patchUrl = officialCnPatchUrl()
const freshBoth = computed(() => !error.value && catalog.value?.source === 'live' && stats.value?.source === 'live')
const updateStatus = computed(() => loading.value ? '正在更新英雄统计…'
  : freshBoth.value ? '英雄统计已更新'
  : stats.value ? '暂时无法更新，展示上次数据' : '英雄统计暂不可用')
const patchGroups: { key: OwPatchTag; title: string; icon: string; caption: string }[] = [
  { key: 'enhances', title: '近期增强', icon: 'up', caption: '技能与数值增强' },
  { key: 'weakens', title: '近期削弱', icon: 'down', caption: '技能与数值削弱' },
  { key: 'adjusts', title: '近期调整', icon: 'adjust', caption: '技能重做与综合调整' },
]
const tacticalStats = computed(() => stats.value?.rows || [])
const roles: Record<OwRole, string> = { '1': '输出', '2': '重装', '3': '支援' }
const leader = (key: Metric) => computed(() => [...allRows.value]
  .filter(row => row.stat[key] != null)
  .sort((a, b) => (b.stat[key] ?? -Infinity) - (a.stat[key] ?? -Infinity))[0])
const winLeader = leader('winRate')
const pickLeader = leader('pickRate')
const banLeader = leader('banRate')
const spotlights = computed(() => [
  { title: '胜率领跑', english: 'WIN RATE', metric: 'winRate' as Metric, icon: 'trophy', row: winLeader.value },
  { title: '人气之选', english: 'PICK RATE', metric: 'pickRate' as Metric, icon: 'flame', row: pickLeader.value },
  { title: '禁用焦点', english: 'BAN RATE', metric: 'banRate' as Metric, icon: 'ban', row: banLeader.value },
])

function getHero(id: string): OwHero {
  return heroMap.value.get(id) || { id, name: id, avatarUrl: '', artUrl: '', description: '', catalogRole: null, isNew: false }
}
function groupHeroes(key: OwPatchTag) { return (balancePatch.value?.groups[key] || catalog.value?.patch[key] || []).map(getHero) }
function formatMetric(value: number | null | undefined) { return value == null || !Number.isFinite(value) ? '—' : value.toFixed(2) + '%' }
function displayDate(value: string) { return value ? value.replace(/\//g, '-').split('T')[0]!.split('-').map(part => part.padStart(2, '0')).join('.') : '—' }

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
}
async function switchView(view: OwView, section = 'ow-top') {
  const changed = activeView.value !== view
  activeView.value = view
  if (view === 'tactics') visitedTactics.value = true
  const url = new URL(location.href)
  url.searchParams.set('view', view)
  if (changed) history.pushState(history.state, '', url)
  else history.replaceState(history.state, '', url)
  emit('navigate')
  if (view !== 'matches' && !stats.value) void boot()
  await nextTick()
  if (view === 'heroes' && section !== 'ow-top') scrollToSection(section)
  else window.scrollTo({ top: 0, behavior: 'auto' })
}
function showPublic(id = 'ow-top') { return switchView('heroes', id) }
function showTactics() { return switchView('tactics') }
function showPrivate() { return switchView('matches') }
function restoreView() {
  activeView.value = viewFromUrl()
  if (activeView.value === 'tactics') visitedTactics.value = true
  if (activeView.value !== 'matches' && !stats.value) void boot()
}
function currentPatchLink(event: MouseEvent | FocusEvent) {
  // Recompute on interaction so a tab left open across a month boundary stays current.
  const link = event.currentTarget as HTMLAnchorElement
  link.href = officialCnPatchUrl()
}

function cleanOldQuery() {
  if (disposed || new URLSearchParams(location.search).get('game') !== 'ow') return
  const url = new URL(location.href)
  for (const key of ['mode', 'season', 'tier', 'role', 'q', 'sort', 'order', 'hero']) url.searchParams.delete(key)
  history.replaceState(history.state, '', url)
}
async function refreshData(forceRefresh = false) {
  loading.value = true
  error.value = ''
  const patchTask = loadOwBalancePatch(lifecycleController.signal).then(result => {
    if (!disposed) { balancePatch.value = result; patchError.value = '' }
  }).catch(() => { if (!disposed) patchError.value = '补丁数据读取暂不可用，显示已有记录。' })
  try {
    const result = await loadOwHomeDataCached({ signal: lifecycleController.signal, forceRefresh })
    if (disposed) return
    catalog.value = result.catalog
    stats.value = result.stats
    error.value = result.statsError || ''
    cleanOldQuery()
  } catch (caught) {
    if (!disposed) {
      error.value = caught instanceof Error ? caught.message : '公开数据暂不可用，请稍后重试。'
      if (catalog.value) catalog.value = { ...catalog.value, source: 'snapshot', liveError: error.value }
      if (stats.value) stats.value = { ...stats.value, source: 'snapshot', liveError: error.value }
    }
  } finally {
    await patchTask
    if (!disposed) loading.value = false
  }
}
function boot(forceRefresh = false): Promise<void> {
  if (disposed) return Promise.resolve()
  if (inFlight) return inFlight
  inFlight = refreshData(forceRefresh).finally(() => { inFlight = null })
  return inFlight
}
onMounted(() => { window.addEventListener('popstate', restoreView); if (activeView.value !== 'matches') void boot(); else { loading.value = false; void loadOwCatalog(lifecycleController.signal, {preferLive:false}).then(value => { if (!disposed) catalog.value=value }).catch(() => {}) } })
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('popstate', restoreView)
  lifecycleController.abort()
})
</script>

<template>
  <div class="ow-section">
    <nav class="ow-subnav ow-container" aria-label="守望先锋板块导航">
      <span class="ow-subnav-identity"><BrandIcon name="ow" :size="28"/><strong>守望先锋</strong><span>国服观察站</span></span>
      <div class="ow-subnav-links">
        <a :class="{ 'is-active': activeView === 'heroes' }" :aria-current="activeView === 'heroes' ? 'page' : undefined" href="/?game=ow&amp;view=heroes" @click.prevent="showPublic('ow-top')">首页</a>
        <button @click="showPublic('ow-changes')">近期调整</button>
        <a :class="{ 'is-active': activeView === 'tactics' }" :aria-current="activeView === 'tactics' ? 'page' : undefined" href="/?game=ow&amp;view=tactics" @click.prevent="showTactics">克制实验室</a>
      <button :class="{ 'is-active': activeView === 'matches' }" @click="showPrivate">我的对局</button></div>
      <span class="ow-public-pill"><i />{{ activeView === 'matches' ? '仅本人可见' : '国服英雄' }}</span>
    </nav>

    <main v-if="activeView === 'matches'" class="ow-container ow-main"><OwMyMatches :heroes="catalog?.heroes || []" /></main>
    <main v-else class="ow-container ow-main">
      <div v-show="activeView === 'heroes'" class="ow-overview">
      <section id="ow-top" class="ow-masthead" aria-labelledby="ow-title">
        <div class="ow-masthead-art" :class="{ 'is-empty': !bannerHero }">
          <img v-if="bannerHero" :key="bannerHero.id" :src="bannerHero.artUrl" :alt="bannerHero.name" fetchpriority="high" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'" />
        </div>
        <div class="ow-masthead-grid" aria-hidden="true" />
        <div class="ow-masthead-copy">
          <span class="ow-eyebrow"><span /> OVERWATCH / UPDATES</span>
          <h1 id="ow-title">{{ currentBanner.title }}<br /><em>{{ currentBanner.subtitle }}</em></h1>
          <p>{{ currentBanner.description }}</p>
          <button v-if="currentBanner.target === 'tactics'" class="ow-banner-action" @click="showTactics">{{ currentBanner.action }} <OwIcon name="chevron" :size="16" /></button>
          <a v-else class="ow-banner-action" :href="currentBanner.target === 'patch' ? patchUrl : officialBoard" target="_blank" rel="noopener noreferrer" @click="currentBanner.target === 'patch' && currentPatchLink($event)" @auxclick="currentBanner.target === 'patch' && currentPatchLink($event)">{{ currentBanner.action }} <OwIcon name="external" :size="14" /></a>
        </div>
        <div v-if="bannerHero" class="ow-art-caption"><span>OVERWATCH</span><strong>{{ bannerHero.name }}</strong></div>
        <div class="ow-banner-selector" aria-label="切换精选内容">
          <button v-for="(slide, index) in bannerContent" :key="slide.id" :class="{ 'is-active': activeBanner === index }" :aria-pressed="activeBanner === index" :aria-label="'切换' + slide.title" @click="activeBanner = index"><OwPortrait :src="heroMap.get(slide.id)?.avatarUrl" :name="slide.title" /></button>
          <span>{{ String(activeBanner + 1).padStart(2, '0') }}<i> / {{ String(bannerContent.length).padStart(2, '0') }}</i></span>
        </div>
      </section>

      <div class="ow-data-strip">
        <span><i class="ow-status-dot" /> 国服公开英雄统计</span>
        <span v-if="stats">{{ selectionText }}</span>
        <span v-if="stats" class="ow-strip-date">官方数据 {{ displayDate(stats.date) }} <span class="ow-source-badge">{{ stats.source === 'live' ? '国服统计' : '上次数据' }}</span></span>
      </div>
      <div class="ow-update-status" role="status"><span>{{ updateStatus }}</span><button :disabled="loading" @click="boot(true)"><OwIcon name="refresh" :size="13" />{{ loading ? '读取中' : '刷新' }}</button></div>

      <section class="ow-spotlights" aria-label="国服英雄数据焦点">
        <a v-for="(spotlight, index) in spotlights" :key="spotlight.metric" class="ow-spotlight" :class="'ow-spotlight-' + index" :href="officialBoard" target="_blank" rel="noopener noreferrer" title="查看国服官网统计" style="text-decoration: none">
          <div class="ow-spotlight-title"><span><OwIcon :name="spotlight.icon" :size="17" />{{ spotlight.title }}</span><small>{{ spotlight.english }}</small></div>
          <div v-if="spotlight.row" class="ow-spotlight-body">
            <div><strong>{{ formatMetric(spotlight.row.stat[spotlight.metric]) }}</strong><span>{{ spotlight.row.hero.name }}<i> / {{ roles[spotlight.row.stat.role] }}</i></span></div>
            <OwPortrait :src="spotlight.row.hero.avatarUrl" :name="spotlight.row.hero.name" />
          </div>
          <div v-else class="ow-spotlight-placeholder"><strong>{{ loading ? '—' : '暂无数据' }}</strong><span>{{ loading ? '正在读取公开英雄数据' : '官网暂未提供有效指标' }}</span></div>
          <span class="ow-spotlight-foot">当前模式、赛季与段位下的最高值<OwIcon name="chevron" :size="15" /></span>
        </a>
      </section>
      <div v-if="error" class="ow-error" role="alert"><OwIcon name="info" :size="24" /><div><strong>公开数据暂不可用</strong><p>暂时无法更新，请稍后重试。</p></div><button @click="boot(true)">重试 <OwIcon name="refresh" :size="15" /></button></div>

      <section id="ow-changes" class="ow-changes" aria-labelledby="ow-changes-title">
        <div class="ow-section-heading">
          <div><span class="ow-kicker">BALANCE WATCH</span><h2 id="ow-changes-title">近期平衡调整<span>。</span></h2></div>
          <div class="ow-heading-aside"><span>{{ patchPublisher }}</span><small>补丁日期 {{ displayDate(patchDate) }}</small><small v-if="patchError || balancePatch?.refreshStatus === 'retained'">暂时无法更新，展示上次记录</small></div>
        </div>
        <div class="ow-change-grid">
          <article v-for="group in patchGroups" :key="group.key" class="ow-change-card" :class="'ow-change-' + group.key">
            <div class="ow-change-title"><span class="ow-change-icon"><img v-if="catalog?.assets.patchIcons[group.key]" :src="catalog.assets.patchIcons[group.key]" alt="" aria-hidden="true" /><OwIcon v-else :name="group.icon" :size="23" /></span><div><h3>{{ group.title }}</h3><p>{{ group.caption }}</p></div><span class="ow-change-count">{{ groupHeroes(group.key).length }}</span></div>
            <div class="ow-change-heroes">
              <a v-for="hero in groupHeroes(group.key)" :key="hero.id" class="ow-change-hero" :href="patchUrl" target="_blank" rel="noopener noreferrer" :aria-label="hero.name + '：查看国服当月补丁'" :title="'查看' + hero.name + '相关国服补丁'" @click="currentPatchLink" @auxclick="currentPatchLink" @focus="currentPatchLink"><OwPortrait :src="hero.avatarUrl" :name="hero.name" /><span>{{ hero.name }}</span></a>
              <span v-if="!catalog" class="ow-muted">正在加载调整信息…</span>
              <span v-else-if="!groupHeroes(group.key).length" class="ow-muted">本期暂无此类调整</span>
            </div>
          </article>
        </div>
        <p class="ow-patch-note"><a :href="patchUrl" target="_blank" rel="noopener noreferrer" @click="currentPatchLink" @auxclick="currentPatchLink" @focus="currentPatchLink">查看国服当月补丁 <OwIcon name="external" :size="12" /></a></p>
      </section>

      </div>
      <OwTactics v-if="catalog && visitedTactics" v-show="activeView === 'tactics'" :heroes="catalog.heroes" :stats="tacticalStats" />
      <div v-if="activeView === 'tactics' && !catalog" class="ow-lab-loading" role="status"><OwIcon name="refresh" :size="24"/><p>{{ loading ? '正在加载英雄克制实验室…' : '英雄资料暂不可用' }}</p><button v-if="!loading" @click="boot(true)">重新加载</button></div>
      <details class="ow-data-credit"><summary>数据说明</summary><p>英雄统计来自国服官网；平衡调整参考官方中文补丁，来源与日期标注于调整区。克制与阵容建议参考社区资料。TrashBox 为非官方社区站点。</p><a :href="officialBoard" target="_blank" rel="noopener noreferrer">国服官网英雄榜 <OwIcon name="external" :size="12" /></a></details>
      <footer class="ow-footer"><span>TRASHBOX <i>×</i> OVERWATCH</span><span>守望先锋社区</span></footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { loadOwHomeData, loadOwStats } from './api'
import type { OwCatalog, OwHero, OwHeroStat, OwPatchTag, OwRole } from './types'
import OwIcon from './OwIcon.vue'
import OwPortrait from './OwPortrait.vue'
import './ow.css'

type Metric = 'winRate' | 'pickRate' | 'banRate'
type HeroRow = { hero: OwHero; stat: OwHeroStat }

const officialBoard = 'https://ow.blizzard.cn/herolist/'
const catalog = ref<OwCatalog | null>(null)
const stats = ref<Awaited<ReturnType<typeof loadOwStats>> | null>(null)
const loading = ref(true)
const error = ref('')
const checkedAt = ref('')
const activeBanner = ref(0)
const lifecycleController = new AbortController()
let disposed = false
let inFlight: Promise<void> | null = null
let refreshTimer: number | undefined
let lastAttemptAt = 0

const bannerContent = [
  { id: 'kiriko', title: '版本更新', subtitle: '与改动记录', description: '这里将展示版本更新与补丁摘要。', note: '当前为轮播占位，具体内容待补充。' },
  { id: 'genji', title: '活动资讯', subtitle: '与限时内容', description: '这里预留新活动的介绍与相关信息。', note: '当前仅展示布局与示意配图。' },
  { id: 'dva', title: '社区动态', subtitle: '与站点公告', description: '这里将发布社区消息与站点更新。', note: '具体内容将在后续补充。' },
]
const currentBanner = computed(() => bannerContent[activeBanner.value] || bannerContent[0]!)
const heroMap = computed(() => new Map(catalog.value?.heroes.map(hero => [hero.id, hero]) || []))
const bannerHero = computed(() => heroMap.value.get(currentBanner.value.id))
const currentSeason = computed(() => catalog.value?.seasons.find(item => item.id === catalog.value?.currentSeasonId))
const selectionText = computed(() => (currentSeason.value?.name || '当前赛季') + ' · 竞技比赛 · 全部段位')
const allRows = computed<HeroRow[]>(() => stats.value?.rows.map(stat => ({ hero: getHero(stat.heroId), stat })) || [])
const patchDate = computed(() => catalog.value?.patch.date || '')
const freshBoth = computed(() => !error.value && catalog.value?.source === 'live' && stats.value?.source === 'live')
const updateStatus = computed(() => loading.value ? '正在检查官网更新…'
  : freshBoth.value ? '官网已检查 · ' + displayTime(checkedAt.value)
  : stats.value ? '本次官网读取不完整，已标出历史数据' : '官网数据暂不可用')
const patchGroups: { key: OwPatchTag; title: string; icon: string; caption: string }[] = [
  { key: 'enhances', title: '近期增强', icon: 'up', caption: '官网标记为增强的英雄' },
  { key: 'weakens', title: '近期削弱', icon: 'down', caption: '官网标记为削弱的英雄' },
  { key: 'adjusts', title: '近期调整', icon: 'adjust', caption: '官网标记为调整的英雄' },
]
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
function groupHeroes(key: OwPatchTag) { return catalog.value?.patch[key].map(getHero) || [] }
function formatMetric(value: number | null | undefined) { return value == null || !Number.isFinite(value) ? '—' : value.toFixed(2) + '%' }
function displayDate(value: string) { return value ? value.replace(/\//g, '-').split('T')[0]!.split('-').map(part => part.padStart(2, '0')).join('.') : '—' }
function displayTime(value: string | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
    : value
}
function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
}
function cleanOldQuery() {
  if (disposed || new URLSearchParams(location.search).get('game') !== 'ow') return
  const url = new URL(location.href)
  for (const key of ['mode', 'season', 'tier', 'role', 'q', 'sort', 'order', 'hero']) url.searchParams.delete(key)
  history.replaceState(history.state, '', url)
}
async function refreshData() {
  loading.value = true
  error.value = ''
  lastAttemptAt = Date.now()
  try {
    const result = await loadOwHomeData({ signal: lifecycleController.signal, preferLive: true })
    if (disposed) return
    catalog.value = result.catalog
    stats.value = result.stats
    checkedAt.value = result.checkedAt
    error.value = result.statsError || ''
    cleanOldQuery()
  } catch (caught) {
    if (!disposed) {
      error.value = caught instanceof Error ? caught.message : '公开数据暂不可用，请稍后重试。'
      if (catalog.value) catalog.value = { ...catalog.value, source: 'snapshot', liveError: error.value }
      if (stats.value) stats.value = { ...stats.value, source: 'snapshot', liveError: error.value }
    }
  } finally {
    if (!disposed) loading.value = false
  }
}
function boot(): Promise<void> {
  if (disposed) return Promise.resolve()
  if (inFlight) return inFlight
  inFlight = refreshData().finally(() => { inFlight = null })
  return inFlight
}
function onReturn() {
  if (document.visibilityState === 'visible' && Date.now() - lastAttemptAt >= 30_000) void boot()
}
onMounted(() => {
  void boot()
  refreshTimer = window.setInterval(() => { if (document.visibilityState === 'visible') void boot() }, 5 * 60_000)
  document.addEventListener('visibilitychange', onReturn)
  window.addEventListener('focus', onReturn)
})
onBeforeUnmount(() => {
  disposed = true
  lifecycleController.abort()
  window.clearInterval(refreshTimer)
  document.removeEventListener('visibilitychange', onReturn)
  window.removeEventListener('focus', onReturn)
})
</script>

<template>
  <div class="ow-section">
    <nav class="ow-subnav ow-container" aria-label="守望先锋板块导航">
      <span class="ow-subnav-identity"><OwIcon name="mark" :size="25" /><strong>守望先锋</strong><span>国服观察站</span></span>
      <div class="ow-subnav-links">
        <button class="is-active" @click="scrollToSection('ow-top')">首页</button>
        <button @click="scrollToSection('ow-changes')">近期调整</button>
        <button @click="scrollToSection('ow-source')">数据来源</button>
      </div>
      <span class="ow-public-pill"><i />公开数据 · 免登录</span>
    </nav>

    <main class="ow-container ow-main">
      <section id="ow-top" class="ow-masthead" aria-labelledby="ow-title">
        <div class="ow-masthead-art" :class="{ 'is-empty': !bannerHero }">
          <img v-if="bannerHero" :key="bannerHero.id" :src="bannerHero.artUrl" :alt="bannerHero.name + '官方英雄示意配图'" fetchpriority="high" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'" />
        </div>
        <div class="ow-masthead-grid" aria-hidden="true" />
        <div class="ow-masthead-copy">
          <span class="ow-eyebrow"><span /> OVERWATCH / UPDATES</span>
          <h1 id="ow-title">{{ currentBanner.title }}<br /><em>{{ currentBanner.subtitle }}</em></h1>
          <p>{{ currentBanner.description }}<br />{{ currentBanner.note }}</p>
          <div class="ow-masthead-meta"><span>占位展示</span><i /><span>内容待补充</span></div>
        </div>
        <div v-if="bannerHero" class="ow-art-caption"><span>示意配图</span><strong>{{ bannerHero.name }}</strong></div>
        <div class="ow-banner-selector" aria-label="切换资讯占位轮播">
          <button v-for="(slide, index) in bannerContent" :key="slide.id" :class="{ 'is-active': activeBanner === index }" :aria-pressed="activeBanner === index" :aria-label="'切换' + slide.title + '占位'" @click="activeBanner = index"><OwPortrait :src="heroMap.get(slide.id)?.avatarUrl" :name="slide.title" /></button>
          <span>{{ String(activeBanner + 1).padStart(2, '0') }}<i> / {{ String(bannerContent.length).padStart(2, '0') }}</i></span>
        </div>
      </section>

      <div class="ow-data-strip">
        <span><i class="ow-status-dot" /> 国服公开英雄统计</span>
        <span v-if="stats">{{ selectionText }}</span>
        <span v-if="stats" class="ow-strip-date">官方数据 {{ displayDate(stats.date) }} <span class="ow-source-badge">{{ stats.source === 'live' ? '官网读取' : '历史快照' }}</span></span>
      </div>
      <div class="ow-update-status" role="status"><span>{{ updateStatus }}</span><button :disabled="loading" @click="boot"><OwIcon name="refresh" :size="13" />{{ loading ? '检查中' : '刷新' }}</button></div>

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
      <div v-if="error" class="ow-error" role="alert"><OwIcon name="info" :size="24" /><div><strong>公开数据暂不可用</strong><p>{{ error }}</p></div><button @click="boot">重试 <OwIcon name="refresh" :size="15" /></button></div>

      <section id="ow-changes" class="ow-changes" aria-labelledby="ow-changes-title">
        <div class="ow-section-heading">
          <div><span class="ow-kicker">BALANCE WATCH</span><h2 id="ow-changes-title">近期平衡调整<span>。</span></h2></div>
          <div class="ow-heading-aside"><span>官网近期调整标签</span><small>官方标签记录于 {{ displayDate(patchDate) }}</small><small v-if="catalog?.source === 'snapshot'">本次读取失败，当前为历史标签</small></div>
        </div>
        <div class="ow-change-grid">
          <article v-for="group in patchGroups" :key="group.key" class="ow-change-card" :class="'ow-change-' + group.key">
            <div class="ow-change-title"><span class="ow-change-icon"><img v-if="catalog?.assets.patchIcons[group.key]" :src="catalog.assets.patchIcons[group.key]" alt="" aria-hidden="true" /><OwIcon v-else :name="group.icon" :size="23" /></span><div><h3>{{ group.title }}</h3><p>{{ group.caption }}</p></div><span class="ow-change-count">{{ groupHeroes(group.key).length }}</span></div>
            <div class="ow-change-heroes">
              <figure v-for="hero in groupHeroes(group.key)" :key="hero.id" class="ow-change-hero"><OwPortrait :src="hero.avatarUrl" :name="hero.name" /><span>{{ hero.name }}</span></figure>
              <span v-if="!catalog" class="ow-muted">正在读取官方标签…</span>
              <span v-else-if="!groupHeroes(group.key).length" class="ow-muted">该类暂无官方标签</span>
            </div>
          </article>
        </div>
        <p class="ow-patch-note"><OwIcon name="info" :size="14" />标签日期与统计日期不同，可能早于当前赛季；同一英雄可同时出现多个标签。<a href="https://ow.blizzard.cn/news/patch-notes/" target="_blank" rel="noopener noreferrer">查看官方补丁说明 <OwIcon name="external" :size="12" /></a></p>
      </section>

      <section class="ow-future-slot" aria-label="更多信息预留区域"><span class="ow-kicker">更多信息</span><h2>内容待补充</h2><p>后续将在这里展示更多信息。</p></section>

      <section id="ow-source" class="ow-source-panel" aria-labelledby="ow-source-title">
        <div class="ow-source-brand"><OwIcon name="mark" :size="40" /></div>
        <div class="ow-source-copy"><span class="ow-kicker">DATA SOURCE</span><h2 id="ow-source-title">数据来源</h2><p>英雄统计与调整标签来自守望先锋国服官网；头像、立绘和图标引用官方资源。TrashBox 是非官方社区站点。</p><small>快照采集 {{ displayTime(stats?.fetchedAt) }}（北京时间） · 官方标签 {{ displayDate(patchDate) }}</small></div>
        <a class="ow-source-link" :href="officialBoard" target="_blank" rel="noopener noreferrer">国服官网英雄榜 <OwIcon name="external" :size="15" /></a>
      </section>
      <footer class="ow-footer"><span>TRASHBOX <i>×</i> OVERWATCH</span><span>守望先锋 · 网页 Demo</span></footer>
    </main>
  </div>
</template>

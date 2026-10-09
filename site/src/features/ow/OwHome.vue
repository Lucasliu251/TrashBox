<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, nextTick } from 'vue'
import { loadOwHomeDataCached, loadOwStats, loadOwBalancePatch, loadOwCatalog } from './api'
import type { OwCatalog, OwHero, OwHeroStat, OwPatchTag, OwRole, OwBalancePatch } from './types'
import OwIcon from './OwIcon.vue'
import OwPortrait from './OwPortrait.vue'
import OwTactics from './OwTactics.vue'
import OwMyMatches from './OwMyMatches.vue'
import './ow.css'

type Metric = 'winRate' | 'pickRate' | 'banRate'
type HeroRow = { hero: OwHero; stat: OwHeroStat }

const officialBoard = 'https://ow.blizzard.cn/herolist/'
const catalog = ref<OwCatalog | null>(null)
const stats = ref<Awaited<ReturnType<typeof loadOwStats>> | null>(null)
const loading = ref(true)
const error = ref('')
const checkedAt = ref('')
const balancePatch = ref<OwBalancePatch | null>(null)
const patchError = ref('')
const activeBanner = ref(0)
const privateMode = ref(new URLSearchParams(location.search).get('view') === 'matches')
const lifecycleController = new AbortController()
let disposed = false
let inFlight: Promise<void> | null = null

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
const patchDate = computed(() => balancePatch.value?.date || catalog.value?.patch.date || '')
const patchPublisher = computed(() => balancePatch.value?.region === 'global' ? '暴雪国际服 · 官方繁体中文' : balancePatch.value ? '网易国服 · 官方简体中文' : '旧 API 调整标签')
const patchUrl = computed(() => balancePatch.value?.sourceUrl || 'https://ow.blizzard.cn/news/patch-notes/')
const freshBoth = computed(() => !error.value && catalog.value?.source === 'live' && stats.value?.source === 'live')
const updateStatus = computed(() => loading.value ? '正在读取公开 API 数据…'
  : freshBoth.value ? 'API 数据 · 读取于 ' + displayTime(checkedAt.value)
  : stats.value ? 'API 读取暂不可用，已标出历史数据' : '官网数据暂不可用')
const patchGroups: { key: OwPatchTag; title: string; icon: string; caption: string }[] = [
  { key: 'enhances', title: '近期增强', icon: 'up', caption: '包含明确增强方向的改动' },
  { key: 'weakens', title: '近期削弱', icon: 'down', caption: '包含明确削弱方向的改动' },
  { key: 'adjusts', title: '近期调整', icon: 'adjust', caption: '混合改动 / 重做 / 其他调整' },
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
async function showPublic(id = 'ow-top') {
  privateMode.value = false
  const url = new URL(location.href);url.searchParams.set('view','heroes');history.replaceState(history.state,'',url)
  if (!stats.value) await boot()
  await nextTick();scrollToSection(id)
}
function showPrivate() {
  privateMode.value = true
  const url = new URL(location.href);url.searchParams.set('view','matches');history.replaceState(history.state,'',url)
  window.scrollTo({top:0,behavior:'auto'})
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
onMounted(() => { if (!privateMode.value) void boot(); else { loading.value = false; void loadOwCatalog(lifecycleController.signal, {preferLive:false}).then(value => { if (!disposed) catalog.value=value }).catch(() => {}) } })
onBeforeUnmount(() => {
  disposed = true
  lifecycleController.abort()
})
</script>

<template>
  <div class="ow-section">
    <nav class="ow-subnav ow-container" aria-label="守望先锋板块导航">
      <span class="ow-subnav-identity"><OwIcon name="mark" :size="25" /><strong>守望先锋</strong><span>国服观察站</span></span>
      <div class="ow-subnav-links">
        <button :class="{ 'is-active': !privateMode }" @click="showPublic('ow-top')">首页</button>
        <button @click="showPublic('ow-changes')">近期调整</button>
        <button @click="showPublic('ow-tactics')">克制 / 阵容</button><button @click="showPublic('ow-source')">数据来源</button>
      <button :class="{ 'is-active': privateMode }" @click="showPrivate">我的对局</button></div>
      <span class="ow-public-pill"><i />{{ privateMode ? '仅本人可见' : '公开英雄数据' }}</span>
    </nav>

    <main v-if="privateMode" class="ow-container ow-main"><OwMyMatches :heroes="catalog?.heroes || []" /></main>
    <main v-else class="ow-container ow-main">
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
        <span v-if="stats" class="ow-strip-date">官方数据 {{ displayDate(stats.date) }} <span class="ow-source-badge">{{ stats.source === 'live' ? '官方 API' : '历史快照' }}</span></span>
      </div>
      <div class="ow-update-status" role="status"><span>{{ updateStatus }}</span><button :disabled="loading" @click="boot(true)"><OwIcon name="refresh" :size="13" />{{ loading ? '读取中' : '刷新' }}</button></div>
      <p class="ow-cache-note">优先复用 1 小时内的公开数据缓存；不定时轮询、不在切回页面时检查。官方统计日期以上方 API 日期为准。</p>

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
      <div v-if="error" class="ow-error" role="alert"><OwIcon name="info" :size="24" /><div><strong>公开数据暂不可用</strong><p>{{ error }}</p></div><button @click="boot(true)">重试 <OwIcon name="refresh" :size="15" /></button></div>

      <section id="ow-changes" class="ow-changes" aria-labelledby="ow-changes-title">
        <div class="ow-section-heading">
          <div><span class="ow-kicker">BALANCE WATCH</span><h2 id="ow-changes-title">近期平衡调整<span>。</span></h2></div>
          <div class="ow-heading-aside"><span>{{ patchPublisher }}</span><small>补丁日期 {{ displayDate(patchDate) }}</small><small v-if="balancePatch">后台核对于 {{ displayTime(balancePatch.checkedAt) }} · 每小时更新</small><small v-if="patchError || balancePatch?.refreshStatus === 'retained'">来源暂不可用，保留最近成功记录</small><small v-if="!balancePatch">补丁缓存暂不可用，当前为旧 API 标签</small></div>
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
        <p v-if="balancePatch" class="ow-patch-original-title">{{ balancePatch.title }}</p>
        <p class="ow-patch-note"><OwIcon name="info" :size="14" />按官方正文的明确数值方向整理；混合改动、重做及命中区域等列入调整，可重复出现。<a :href="patchUrl" target="_blank" rel="noopener noreferrer">查看官方中文原文 <OwIcon name="external" :size="12" /></a></p>
        <p v-if="balancePatch?.region === 'global'" class="ow-patch-original-title">当前采用日期较新的国际服官方中文记录；国服同步情况以国服公告为准。</p>
        <p v-if="balancePatch?.unmappedNames.length" class="ow-patch-original-title">新英雄名称待匹配：{{ balancePatch.unmappedNames.join('、') }}</p>
      </section>

      <OwTactics v-if="catalog" :heroes="catalog.heroes" :stats="tacticalStats" />

      <section class="ow-future-slot" aria-label="更多信息预留区域"><span class="ow-kicker">更多信息</span><h2>内容待补充</h2><p>后续将在这里展示更多信息。</p></section>

      <section id="ow-source" class="ow-source-panel" aria-labelledby="ow-source-title">
        <div class="ow-source-brand"><OwIcon name="mark" :size="40" /></div>
        <div class="ow-source-copy"><span class="ow-kicker">DATA SOURCE</span><h2 id="ow-source-title">数据来源</h2><p>英雄统计来自国服官方 API；调整信息优先采用日期更新的国服或国际服官方中文补丁。头像、立绘和图标引用官方资源。TrashBox 是非官方社区站点。</p><small>快照采集 {{ displayTime(stats?.fetchedAt) }}（北京时间） · 补丁日期 {{ displayDate(patchDate) }}</small></div>
        <a class="ow-source-link" :href="officialBoard" target="_blank" rel="noopener noreferrer">国服官网英雄榜 <OwIcon name="external" :size="15" /></a>
      </section>
      <footer class="ow-footer"><span>TRASHBOX <i>×</i> OVERWATCH</span><span>守望先锋 · 网页 Demo</span></footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import RichContent from './RichContent'
import { accountUrl, API_BASE, AuthRequestError, redirectToLogin } from '../../shared/auth'

const props = defineProps<{ accountDisplayName: string; steamId: string | null }>()

type View = 'home' | 'posts' | 'post' | 'rank' | 'stats' | 'reaction'
type Post = { id: number; title: string; content?: string; summary?: string; tag?: string; views?: number; date?: string; created_at?: string; author?: string; nickname?: string; avatar?: string; cover?: string }
type Comment = { content: string; nickname?: string; created_at?: string; avatar?: string }
type Rank = { rank: number; nickname: string; steam_id: string; avatar?: string; daily_Rating: number; daily_adr: number; daily_kd: number; daily_kills: number; daily_mvp: number }
type Day = { date: string; Rating: number; kills: number; deaths: number; kd: number; adr: number; mvp: number; hsr: number; dmg: number; rounds_played: number }
type Player = { steam_id: string; nickname: string; avatar?: string; style_tag?: string; summary: Record<string, number> & { server_avg?: Record<string, number> }; history: Day[] }
type SearchUser = { steam_id: string; nickname?: string; avatar?: string }
type ReactionState = 'idle' | 'waiting' | 'ready' | 'early' | 'done'

const allowed: View[] = ['home', 'posts', 'post', 'rank', 'stats', 'reaction']
const query = new URLSearchParams(location.search)
const initial = query.get('view') as View | null
const view = ref<View>(initial && allowed.includes(initial) ? initial : 'home')
const selectedId = ref(query.get('id') || '')
const posts = ref<Post[]>([])
const rank = ref<Rank[]>([])
const article = ref<Post | null>(null)
const comments = ref<Comment[]>([])
const player = ref<Player | null>(null)
const searchText = ref('')
const results = ref<SearchUser[]>([])
const postsError = ref('')
const rankError = ref('')
const pageError = ref('')
const searchError = ref('')
const loadingPosts = ref(false)
const loadingRank = ref(false)
const loadingPage = ref(false)
const loadingSearch = ref(false)
const postsOffset = ref(0)
const postsEnd = ref(false)

function dateOffset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const rankDate = ref(dateOffset(-1))

const banners = [
  { title: 'Major: 布达佩斯激战开启', shade: 'major' },
  { title: '更新日志: 2026年服役勋章', shade: 'medal' },
  { title: 'Top #14 XANTARES', shade: 'player' },
]
const bannerIndex = ref(0)
let bannerTimer: number | undefined

const reactionState = ref<ReactionState>('idle')
const reactionScores = ref<number[]>([])
const reactionMessage = ref('反应力测试')
const reactionSub = ref('点击屏幕任意区域开始')
const reactionAverage = computed(() => reactionScores.value.length === 5
  ? Math.round(reactionScores.value.reduce((sum, value) => sum + value, 0) / 5) : 0)
const reactionEvaluation = computed(() => reactionAverage.value < 180 ? 'NiKo 附体！这是人类的极限吗？'
  : reactionAverage.value < 220 ? '职业哥水平，你的大狙一定很准。'
  : reactionAverage.value < 260 ? '正常水平，打打竞技完全够用。'
  : '老年人反应...建议玩道具辅助位。')
let reactionTimer: number | undefined
let reactionStart = 0

function safeImage(value?: string | null) {
  if (!value) return ''
  try {
    const url = new URL(value, location.origin)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch { return '' }
}

function avatar(value?: string | null) {
  return safeImage(value) || '/icons/cs-logo-grey.avif'
}

function hideBrokenImage(event: Event) {
  const image = event.currentTarget
  if (image instanceof HTMLImageElement) image.style.display = 'none'
}

function number(value: number | undefined, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—'
}

async function request<T>(path: string): Promise<T> {
  // Community endpoints include pagination or rankings alongside their data.
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include', headers: { Accept: 'application/json' } })
  const body = await response.json().catch(() => null)
  if (response.status === 401) { redirectToLogin(); throw new AuthRequestError(401, '登录已过期') }
  if (!response.ok) throw new Error(response.status === 502 ? '数据服务暂不可用' : `请求失败 (${response.status})`)
  if (body?.code && body.code !== 200) throw new Error(body.message || '数据加载失败')
  return body as T
}

async function fetchPosts(reset = false) {
  if (loadingPosts.value || (postsEnd.value && !reset)) return
  loadingPosts.value = true
  postsError.value = ''
  try {
    const offset = reset ? 0 : postsOffset.value
    const body = await request<{ data: Post[]; pagination?: { has_more: boolean } }>(`/api/v1/posts?limit=10&offset=${offset}`)
    const batch = Array.isArray(body.data) ? body.data : []
    posts.value = reset ? batch : [...posts.value, ...batch]
    postsOffset.value = offset + batch.length
    postsEnd.value = !(body.pagination?.has_more ?? batch.length === 10)
  } catch (error) { postsError.value = error instanceof Error ? error.message : '动态加载失败' }
  finally { loadingPosts.value = false }
}

async function fetchRank() {
  loadingRank.value = true
  rankError.value = ''
  try {
    const body = await request<{ rankings: Rank[] }>(`/api/v1/rankings/daily?date=${encodeURIComponent(rankDate.value)}`)
    rank.value = body.rankings || []
  } catch (error) { rankError.value = error instanceof Error ? error.message : '榜单加载失败' }
  finally { loadingRank.value = false }
}

async function fetchArticle() {
  if (!/^\d+$/.test(selectedId.value)) { pageError.value = '动态编号无效'; return }
  loadingPage.value = true
  pageError.value = ''
  article.value = null
  try {
    const body = await request<{ data: { info: Post; comments: Comment[] } }>(`/api/v1/posts/${selectedId.value}`)
    article.value = body.data.info
    comments.value = body.data.comments || []
  } catch (error) { pageError.value = error instanceof Error ? error.message : '动态加载失败' }
  finally { loadingPage.value = false }
}

async function fetchPlayer() {
  if (!/^\d{17}$/.test(selectedId.value)) { pageError.value = '请输入 17 位 Steam ID'; return }
  loadingPage.value = true
  pageError.value = ''
  player.value = null
  try { player.value = await request<Player>(`/api/v1/players/${selectedId.value}/history?days=30`) }
  catch (error) { pageError.value = error instanceof Error ? error.message : '玩家数据加载失败' }
  finally { loadingPage.value = false }
}

async function searchPlayer() {
  const value = searchText.value.trim()
  if (!value) { searchError.value = '请输入搜索内容'; return }
  loadingSearch.value = true
  searchError.value = ''
  results.value = []
  try {
    const body = await request<{ data: SearchUser[] }>(`/api/v1/users/search?q=${encodeURIComponent(value)}`)
    results.value = body.data || []
    if (results.value.length === 1) navigate('stats', results.value[0]!.steam_id)
    else if (!results.value.length) searchError.value = '未找到该玩家'
  } catch (error) { searchError.value = error instanceof Error ? error.message : '搜索失败' }
  finally { loadingSearch.value = false }
}

function loadView() {
  if (view.value === 'home') { void fetchPosts(true); void fetchRank() }
  if (view.value === 'posts') void fetchPosts(true)
  if (view.value === 'rank') void fetchRank()
  if (view.value === 'post') void fetchArticle()
  if (view.value === 'stats') {
    if (!selectedId.value && props.steamId) selectedId.value = props.steamId
    if (selectedId.value) void fetchPlayer()
  }
}

function navigate(target: View, id = '') {
  view.value = target
  selectedId.value = id
  pageError.value = ''
  searchError.value = ''
  results.value = []
  const url = target === 'home' ? '/' : `/?view=${target}${id ? `&id=${encodeURIComponent(id)}` : ''}`
  history.pushState({}, '', url)
  window.scrollTo({ top: 0, behavior: 'smooth' })
  loadView()
}

function onPopState() {
  const query = new URLSearchParams(location.search)
  const next = query.get('view') as View | null
  view.value = next && allowed.includes(next) ? next : 'home'
  selectedId.value = query.get('id') || ''
  loadView()
}

function handleReaction() {
  if (reactionState.value === 'done') return
  if (reactionState.value === 'idle' || reactionState.value === 'early') {
    reactionState.value = 'waiting'
    reactionMessage.value = '等待变绿...'
    reactionSub.value = '准备好你的手指'
    reactionTimer = window.setTimeout(() => {
      reactionStart = performance.now()
      reactionState.value = 'ready'
      reactionMessage.value = '点击！'
      reactionSub.value = ''
    }, 2000 + Math.random() * 3000)
  } else if (reactionState.value === 'waiting') {
    window.clearTimeout(reactionTimer)
    reactionState.value = 'early'
    reactionMessage.value = '太早了！'
    reactionSub.value = '点击屏幕重试'
  } else {
    const elapsed = Math.round(performance.now() - reactionStart)
    reactionScores.value.push(elapsed)
    if (reactionScores.value.length === 5) {
      reactionState.value = 'done'
      reactionMessage.value = '测试完成'
      reactionSub.value = ''
    } else {
      reactionState.value = 'idle'
      reactionMessage.value = `${elapsed} ms`
      reactionSub.value = '点击屏幕继续下一回合'
    }
  }
}

function resetReaction() {
  window.clearTimeout(reactionTimer)
  reactionScores.value = []
  reactionState.value = 'idle'
  reactionMessage.value = '反应力测试'
  reactionSub.value = '点击屏幕任意区域开始'
}

const axes = [
  { label: 'KPR', key: 'avg_KPR', min: 0, max: 2.3 },
  { label: 'ADR', key: 'avg_ADR', min: 0, max: 150 },
  { label: 'SPR', key: 'avg_SPR', min: -3, max: 1 },
  { label: 'WR', key: 'avg_WR', min: 0, max: 80 },
  { label: 'MPR', key: 'avg_MPR', min: 0, max: 0.8 },
  { label: 'HSR', key: 'avg_HSR', min: 0, max: 100 },
]
function polar(index: number, scale: number) {
  const angle = -Math.PI / 2 + index * Math.PI / 3
  return `${150 + Math.cos(angle) * 105 * scale},${150 + Math.sin(angle) * 105 * scale}`
}
const chartGrid = [0.25, 0.5, 0.75, 1].map(scale => axes.map((_, index) => polar(index, scale)).join(' '))
const chartPoints = computed(() => axes.map((axis, index) => {
  const value = Number(player.value?.summary[axis.key] || 0)
  const scale = Math.max(0.08, Math.min(1, (value - axis.min) / (axis.max - axis.min)))
  return polar(index, scale)
}).join(' '))
const trendDays = computed(() => player.value?.history.slice(-7) || [])
const trendPoints = computed(() => {
  const days = trendDays.value
  const max = Math.max(2, ...days.map(day => Number(day.kd) || 0))
  return days.map((day, index) => `${25 + index * (300 / Math.max(1, days.length - 1))},${155 - (Number(day.kd) || 0) / max * 125}`).join(' ')
})

onMounted(() => {
  window.addEventListener('popstate', onPopState)
  bannerTimer = window.setInterval(() => { bannerIndex.value = (bannerIndex.value + 1) % banners.length }, 5000)
  loadView()
})
onBeforeUnmount(() => {
  window.removeEventListener('popstate', onPopState)
  window.clearInterval(bannerTimer)
  window.clearTimeout(reactionTimer)
})
</script>

<template>
  <div class="community-app">
    <header class="topbar">
      <button class="site-name" @click="navigate('home')">TrashBox</button>
      <nav class="desktop-tabs" aria-label="主站导航">
        <button :class="{ selected: ['home', 'posts', 'post'].includes(view) }" @click="navigate('home')">社区</button>
        <button :class="{ selected: view === 'reaction' }" @click="navigate('reaction')">反应测试</button>
        <button :class="{ selected: view === 'rank' }" @click="navigate('rank')">排行</button>
        <button :class="{ selected: view === 'stats' }" @click="navigate('stats')">数据</button>
      </nav>
      <a class="account-entry" :href="accountUrl()" :title="props.accountDisplayName">我的账号</a>
    </header>

    <main class="page-shell" :class="{ 'reaction-page': view === 'reaction' }">
      <template v-if="view === 'home'">
        <form class="search-section" @submit.prevent="searchPlayer">
          <div class="search-capsule"><span class="search-symbol">⌕</span><input v-model="searchText" aria-label="搜索玩家" placeholder="搜索玩家 / 比赛 ID" /><button type="submit">搜索</button></div>
          <p v-if="searchError" class="form-error">{{ searchError }}</p>
          <div v-if="results.length > 1" class="search-results"><button v-for="user in results" :key="user.steam_id" type="button" @click="navigate('stats', user.steam_id)"><img :src="avatar(user.avatar)" alt="" />{{ user.nickname || user.steam_id }}</button></div>
        </form>

        <section class="swiper-container" aria-label="社区轮播图">
          <div class="swiper-slide" :class="banners[bannerIndex]!.shade"><div class="banner-shadow"></div><strong>{{ banners[bannerIndex]!.title }}</strong></div>
          <div class="swiper-dots"><button v-for="(item, index) in banners" :key="item.title" :class="{ active: index === bannerIndex }" :aria-label="`第 ${index + 1} 张`" @click="bannerIndex = index"></button></div>
        </section>

        <section class="mini-section"><div class="section-header"><h2>Rating 榜单</h2><button @click="navigate('rank')">全部 ›</button></div>
          <p v-if="rankError" class="section-message">{{ rankError }}</p>
          <p v-else-if="!rank.length" class="section-message">{{ loadingRank ? '正在加载榜单…' : '昨日战报正在生成中...' }}</p>
          <button v-for="item in rank.slice(0, 5)" :key="item.steam_id" class="player-row" @click="navigate('stats', item.steam_id)">
            <span class="rank-num" :class="`rank-${item.rank}`">{{ item.rank }}</span><img class="player-avatar" :src="avatar(item.avatar)" alt="" />
            <span class="player-info"><strong>{{ item.nickname || item.steam_id }}</strong><small v-if="item.daily_mvp">★ {{ item.daily_mvp }} MVPs</small></span>
            <span class="player-metrics"><span :class="{ gold: item.daily_Rating >= 1.2 }">{{ number(item.daily_Rating, 2) }}<small>Rating</small></span><span>{{ number(item.daily_adr) }}<small>ADR</small></span></span>
          </button>
        </section>

        <section class="mini-section"><div class="section-header"><h2>社区动态</h2><button @click="navigate('posts')">全部 ›</button></div>
          <p v-if="postsError" class="section-message">{{ postsError }}</p>
          <p v-else-if="!posts.length" class="section-message">{{ loadingPosts ? '正在加载动态…' : '暂无动态' }}</p>
          <button v-for="item in posts.slice(0, 4)" :key="item.id" class="news-item" @click="navigate('post', String(item.id))"><span class="news-main"><span class="news-heading"><small>{{ item.tag || '社区' }}</small><strong>{{ item.title }}</strong></span><span v-if="item.summary" class="news-summary">{{ item.summary }}</span><span class="news-meta">{{ item.author || '神秘玩家' }}　{{ item.date || '' }}　{{ item.views || 0 }}阅读</span></span><img v-if="safeImage(item.cover)" class="news-cover" :src="safeImage(item.cover)" alt="" @error="hideBrokenImage" /></button>
        </section>
      </template>

      <template v-else-if="view === 'posts'">
        <div class="subpage-header"><button @click="navigate('home')">‹ 返回</button><h1>社区动态</h1></div>
        <section class="news-list"><p v-if="postsError" class="section-message">{{ postsError }}</p><p v-else-if="!posts.length" class="section-message">{{ loadingPosts ? '正在加载…' : '暂无动态' }}</p><button v-for="item in posts" :key="item.id" class="news-item" @click="navigate('post', String(item.id))"><span class="news-main"><span class="news-heading"><small>{{ item.tag || '社区' }}</small><strong>{{ item.title }}</strong></span><span v-if="item.summary" class="news-summary">{{ item.summary }}</span><span class="news-meta">{{ item.author || '神秘玩家' }}　{{ item.date || '' }}　{{ item.views || 0 }}阅</span></span><img v-if="safeImage(item.cover)" class="news-cover" :src="safeImage(item.cover)" alt="" @error="hideBrokenImage" /></button><button v-if="posts.length && !postsEnd" class="load-more" :disabled="loadingPosts" @click="fetchPosts()">{{ loadingPosts ? '加载中…' : '加载更多' }}</button></section>
      </template>

      <template v-else-if="view === 'post'">
        <div class="subpage-header"><button @click="navigate('posts')">‹ 返回</button><h1>动态详情</h1></div><p v-if="pageError" class="section-message">{{ pageError }}</p>
        <article v-if="article" class="post-detail"><h2>{{ article.title }}</h2><div class="author-info"><img :src="avatar(article.avatar)" alt="" /><span>{{ article.nickname || article.author || '神秘玩家' }}<small>{{ article.date || article.created_at }} · {{ article.views || 0 }} 阅读</small></span></div><RichContent :html="article.content || ''" /><div class="comments"><h3>全部评论 ({{ comments.length }})</h3><p v-if="!comments.length" class="section-message">暂无评论</p><div v-for="(comment, index) in comments" :key="index" class="comment"><img :src="avatar(comment.avatar)" alt="" /><div><small>{{ comment.nickname || '玩家' }}　{{ comment.created_at || '' }}</small><p>{{ comment.content }}</p></div></div></div></article>
        <div class="comment-bar"><span>网页暂不支持发表评论</span></div>
      </template>

      <template v-else-if="view === 'rank'">
        <div class="subpage-header"><button @click="navigate('home')">‹ 返回</button><h1>每日排行榜</h1></div>
        <div class="rank-toolbar"><label>📅 <input v-model="rankDate" type="date" @change="fetchRank" /></label><span title="微信订阅消息仅小程序可用">日报订阅 · 小程序内使用</span></div>
        <div class="rank-columns"><span>排名</span><span>玩家</span><span>数据 (KD/ADR)</span></div>
        <p v-if="rankError" class="section-message">{{ rankError }}</p><p v-else-if="!rank.length" class="section-message">{{ loadingRank ? '正在加载榜单…' : '该日期暂无比赛数据' }}</p>
        <button v-for="item in rank" :key="item.steam_id" class="player-row rank-list-row" @click="navigate('stats', item.steam_id)"><span class="rank-num" :class="`rank-${item.rank}`">{{ item.rank }}</span><img class="player-avatar" :src="avatar(item.avatar)" alt="" /><span class="player-info"><strong>{{ item.nickname || item.steam_id }}</strong><small v-if="item.daily_mvp">★ {{ item.daily_mvp }} MVPs</small></span><span class="player-metrics"><span :class="{ gold: item.daily_Rating >= 1.2 }">{{ number(item.daily_Rating, 2) }}<small>Rating</small></span><span>{{ number(item.daily_adr) }}<small>ADR</small></span></span></button>
      </template>

      <template v-else-if="view === 'stats'">
        <div class="subpage-header"><button v-if="selectedId" @click="navigate('home')">‹ 返回</button><h1>数据</h1></div>
        <div v-if="!selectedId" class="empty-stats"><img src="/icons/cs-logo-grey.avif" alt="" /><h2>绑定 Steam 账号开启数据分析</h2><p>查看您的 Rating、ADR 及比赛走势</p><a class="stats-bind-account" :href="accountUrl()">绑定 Steam</a><form @submit.prevent="searchPlayer"><input v-model="searchText" aria-label="Steam ID 或玩家昵称" placeholder="输入 Steam ID 或玩家昵称" /><button type="submit">查找玩家</button></form><p v-if="searchError" class="form-error">{{ searchError }}</p><div v-if="results.length > 1" class="search-results"><button v-for="user in results" :key="user.steam_id" @click="navigate('stats', user.steam_id)">{{ user.nickname || user.steam_id }}</button></div></div>
        <p v-if="pageError" class="section-message">{{ pageError }}</p>
        <div v-if="player" class="stats-dashboard"><div class="profile-card"><div class="playtime-tag"><small>游戏时长</small>{{ number((player.summary.time_played || 0) / 3600) }}h</div><div class="style-badge"><small>STYLE</small>{{ player.style_tag || '凡' }}</div><div class="profile-info"><img :src="avatar(player.avatar)" alt="" /><div><strong>{{ player.nickname || player.steam_id }}</strong><small>ID: {{ player.steam_id }}</small></div></div></div><div class="stats-grid"><div><small>Avg K/D (30d)</small><strong :class="{ gold: player.summary.avg_kd >= 1.2 }">{{ number(player.summary.avg_kd, 2) }}</strong></div><div><small>★StarTrack™️</small><strong>{{ player.summary.period_kills || 0 }}</strong></div><div><small>ADR</small><strong>{{ number(player.summary.avg_ADR, 2) }}</strong></div><div><small>Win Rate</small><strong>{{ number(player.summary.avg_WR) }}%</strong></div></div><h2 class="data-heading">能力模型 (Capability)</h2><div class="chart-container radar-chart"><svg viewBox="0 0 300 300" aria-label="六项能力雷达图"><polygon v-for="points in chartGrid" :key="points" :points="points" class="grid-polygon" /><line v-for="(_, index) in axes" :key="index" x1="150" y1="150" :x2="polar(index, 1).split(',')[0]" :y2="polar(index, 1).split(',')[1]" class="grid-line" /><polygon :points="chartPoints" class="data-polygon" /><text v-for="(axis, index) in axes" :key="axis.key" :x="Number(polar(index, 1).split(',')[0])" :y="Number(polar(index, 1).split(',')[1])" text-anchor="middle" class="chart-label">{{ axis.label }}</text></svg></div><h2 class="data-heading">近期状态 (KD Trend)</h2><div class="chart-container trend-chart"><svg v-if="trendDays.length" viewBox="0 0 350 180" aria-label="近期 KD 趋势"><line x1="25" y1="90" x2="325" y2="90" class="grid-line" stroke-dasharray="4 4" /><polyline :points="trendPoints" fill="none" stroke="#de9b35" stroke-width="3" stroke-linejoin="round" /><circle v-for="(day, index) in trendDays" :key="day.date" :cx="25 + index * (300 / Math.max(1, trendDays.length - 1))" :cy="Number(trendPoints.split(' ')[index]?.split(',')[1] || 0)" r="4" fill="#de9b35" /></svg><p v-else>暂无趋势数据</p></div><h2 class="data-heading">每日战报 (Daily Log)</h2><p v-if="!player.history.length" class="section-message">暂无比赛记录</p><div v-for="day in [...player.history].reverse()" :key="day.date" class="match-item"><div class="match-left"><strong>{{ day.date.slice(5) }}</strong><small>{{ day.rounds_played }} Rnds</small></div><div class="match-score"><strong>{{ day.kills }} / {{ day.deaths }}</strong><small :class="day.Rating >= 1 ? 'positive' : 'negative'">{{ number(day.Rating, 2) }} Rating</small></div><div class="match-data"><span>ADR: <b>{{ number(day.adr) }}</b></span><span>MVP: <b>{{ day.mvp }}</b></span><span>HS%: <b>{{ number(day.hsr) }}</b></span><span>DMG: <b>{{ day.dmg }}</b></span></div></div></div>
      </template>

      <template v-else-if="view === 'reaction'"><button class="reaction-screen" :class="reactionState" @click="handleReaction"><img v-if="reactionState === 'idle' || reactionState === 'done'" src="/icons/cs-logo-grey.avif" alt="" /><strong>{{ reactionMessage }}</strong><span>{{ reactionSub }}</span><div v-if="reactionScores.length && reactionState !== 'done'" class="reaction-history">测试进度 ({{ reactionScores.length }}/5)<p>{{ reactionScores.join(' ms　') }} ms</p></div></button><div v-if="reactionState === 'done'" class="reaction-result"><div><small>平均反应时间</small><strong>{{ reactionAverage }} <span>ms</span></strong></div><p>{{ reactionEvaluation }}</p><button @click="resetReaction">再测一次</button><small>成绩保存功能待账号体系接入</small></div></template>
    </main>

    <nav class="tabbar" aria-label="页面导航"><button :class="{ selected: ['home', 'posts', 'post'].includes(view) }" @click="navigate('home')"><img :src="['home', 'posts', 'post'].includes(view) ? '/icons/home-active.png' : '/icons/home.png'" alt="" />社区</button><button :class="{ selected: view === 'reaction' }" @click="navigate('reaction')"><img :src="view === 'reaction' ? '/icons/Flash-active.png' : '/icons/Flash.png'" alt="" />反应测试</button><button :class="{ selected: view === 'rank' }" @click="navigate('rank')"><span class="rank-tab-icon">▥</span>排行</button><button :class="{ selected: view === 'stats' }" @click="navigate('stats')"><img :src="view === 'stats' ? '/icons/chart-active.png' : '/icons/chart.png'" alt="" />数据</button></nav>
  </div>
</template>

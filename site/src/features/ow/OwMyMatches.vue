<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { authRequest, AuthRequestError, providerUrl, redirectToLogin } from '../../../../shared/auth'
import type { OwHero } from './types'
import OwPortrait from './OwPortrait.vue'
import './my-matches.css'

interface Match {
  id: string; started_at: string; source_season: number | null
  map_name: string | null; hero_name: string | null; mode: string | null; role: string | null
  outcome: 'win' | 'loss' | 'draw' | 'unknown'; team_score: number | null; opponent_score: number | null
  kills: number | null; assists: number | null; deaths: number | null; damage: number | null; healing: number | null
}
interface Status {
  configured: boolean; battle_net_enabled: boolean; count: number
  binding: { battle_tag: string; enabled: boolean; verified_at: string; last_synced_at: string | null; needs_reverification: boolean } | null
  job: { id: string; status: string; error_code: string | null; imported_count: number } | null
}
const props = defineProps<{ heroes: OwHero[] }>()
const status = ref<Status | null>(null), matches = ref<Match[]>([])
const loading = ref(true), busy = ref(false), error = ref(''), notice = ref('')
const offset = ref(0), hasMore = ref(false), expanded = ref<string | null>(null)
const controller = new AbortController()
let disposed = false, timer: number | undefined, checks = 0
const returnTo = '/?game=ow&view=matches'
const link = computed(() => providerUrl('battlenet', 'link', returnTo))
const active = computed(() => !!status.value?.binding?.enabled)
const pending = computed(() => ['pending', 'running'].includes(status.value?.job?.status || ''))
const outcomes = { win: '胜利', loss: '失败', draw: '平局', unknown: '结果未提供' }
const pageWins = computed(() => matches.value.filter(row => row.outcome === 'win').length)
const pageLosses = computed(() => matches.value.filter(row => row.outcome === 'loss').length)
const hero = (name: string | null) => props.heroes.find(item => item.name.toLowerCase() === name?.toLowerCase())
const metric = (value: number | null) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
const moment = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', month: '2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)) : '尚未同步'
const mode = (value: string | null) => value === 'IT_RANKED' ? '竞技' : value === 'IT_QUICK' || value === 'IT_QUICKPLAY' ? '快速' : '对局'
function failure(caught: unknown) {
  if (caught instanceof AuthRequestError && caught.status === 401) { redirectToLogin(); return }
  error.value = caught instanceof Error ? caught.message : '战绩读取失败，请稍后重试。'
}
async function read() {
  loading.value = true; error.value = ''
  try {
    const current = await authRequest<Status>('/api/v1/me/ow/status', {signal:controller.signal})
    const result = current.binding?.enabled ? await authRequest<{matches:Match[];has_more:boolean}>(`/api/v1/me/ow/matches?limit=20&offset=${offset.value}`, {signal:controller.signal}) : {matches:[],has_more:false}
    if (disposed) return
    status.value = current; matches.value = result.matches; hasMore.value = result.has_more
    if (current.job?.status === 'failed') notice.value = current.job.error_code === 'reverification_required' || current.job.error_code === 'identity_mismatch' ? '账号来源未能核实，请重新连接战网后再试。' : '对局来源暂不可用，已保存战绩仍保留。可以稍后重新同步。'
    else if (current.job?.status === 'done') notice.value = `最近一次同步处理 ${current.job.imported_count} 场对局，相同对局不会重复保存。`
  } catch (caught) { if (!disposed && !controller.signal.aborted) failure(caught) }
  finally { if (!disposed) loading.value = false }
}
function watchRequestedJob() {
  window.clearTimeout(timer)
  // Only after a deliberate sync request; never keep polling an idle page.
  if (!disposed && pending.value && checks++ < 60) timer = window.setTimeout(async () => { await read(); watchRequestedJob() }, 5000)
}
async function consent(enabled: boolean) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    await authRequest('/api/v1/me/ow/sync-consent', {method:'POST',body:JSON.stringify({enabled})})
    offset.value=0; checks=0; await read()
    if (enabled) watchRequestedJob()
    else { window.clearTimeout(timer); notice.value='已暂停同步并隐藏战绩；已保存记录仍仅归你所有，重新开启后可恢复查看。' }
  } catch (caught) { failure(caught) }
  finally { busy.value=false }
}
async function synchronize() {
  if (busy.value) return
  busy.value=true; error.value=''; notice.value=''
  try { await authRequest('/api/v1/me/ow/sync', {method:'POST'}); offset.value=0;checks=0;await read();watchRequestedJob() }
  catch(caught) { failure(caught) }
  finally { busy.value=false }
}
async function page(delta:number) { offset.value=Math.max(0,offset.value+delta);await read() }
onMounted(read)
onBeforeUnmount(() => { disposed=true;controller.abort();window.clearTimeout(timer) })
</script>

<template>
  <section class="ow-my-matches" aria-labelledby="ow-my-matches-title">
    <header class="ow-personal-heading"><div><span class="ow-kicker">YOUR MATCHES</span><h1 id="ow-my-matches-title">我的对局</h1><p>只同步你已验证的国服账号，战绩仅你可见。</p></div><span class="ow-personal-badge">本人专属</span></header>
    <p v-if="error" class="ow-personal-error" role="alert">{{ error }} <button @click="read">重试</button></p>
    <p v-if="loading && !status" class="ow-personal-empty" role="status">正在读取账号与同步状态…</p>
    <section v-else-if="status && !status.configured" class="ow-personal-connect"><h2>战绩接入准备中</h2><p>站点正在准备对局数据服务。完成后，你可以连接战网并开启本人战绩同步。</p><a v-if="status.battle_net_enabled" class="ow-personal-button" :href="link">连接国服战网</a><span v-else class="ow-personal-muted">战网验证尚未开放</span></section>
    <section v-else-if="status && !status.binding" class="ow-personal-connect"><h2>连接你的战网账号</h2><p>通过战网官方授权验证账号归属；不需要提交密码或手动填写别人的 BattleTag。</p><a v-if="status.battle_net_enabled" class="ow-personal-button" :href="link">通过战网继续</a><p v-else class="ow-personal-muted">战网验证尚未开放，请稍后再试。</p></section>
    <template v-else-if="status?.binding">
      <section class="ow-personal-account"><div><strong>{{ status.binding.battle_tag }}</strong><span>已验证 · 最近同步 {{ moment(status.binding.last_synced_at) }}</span></div><div class="ow-personal-actions"><a v-if="status.binding.needs_reverification" class="ow-personal-button" :href="link">重新验证战网</a><button v-else-if="!active" class="ow-personal-button" :disabled="busy" @click="consent(true)">开启我的战绩同步</button><template v-else><button class="ow-personal-button" :disabled="busy || pending" @click="synchronize">{{ pending ? '同步处理中…' : '同步最新对局' }}</button><button class="ow-personal-text" :disabled="busy" @click="consent(false)">暂停并隐藏</button></template></div></section>
      <p class="ow-personal-policy">开启后会定期同步本人近期对局；不保存其他参与者的昵称、账号或个人指标。来源能提供的历史范围可能有限。</p>
      <p v-if="notice" class="ow-personal-notice" role="status">{{ notice }}</p>
      <template v-if="active">
        <div class="ow-personal-summary"><span>已保存 <strong>{{ status.count }}</strong> 场</span><span>本页 <strong>{{ pageWins }}</strong> 胜 / <strong>{{ pageLosses }}</strong> 负</span><button class="ow-personal-text" :disabled="loading" @click="read">{{ loading ? '读取中…' : '刷新列表' }}</button></div>
        <p v-if="!matches.length" class="ow-personal-empty">{{ pending ? '同步已加入队列，完成后会展示战绩。' : '暂未同步到可用对局。来源可能尚无记录，可以稍后重试。' }}</p>
        <div v-else class="ow-personal-list"><article v-for="match in matches" :key="match.id" class="ow-personal-match" :class="match.outcome">
          <button class="ow-personal-match-main" :aria-expanded="expanded === match.id" @click="expanded = expanded === match.id ? null : match.id"><span class="ow-personal-result">{{ outcomes[match.outcome] }}</span><OwPortrait :src="hero(match.hero_name)?.avatarUrl" :name="match.hero_name || '英雄'"/><span class="ow-personal-map"><strong>{{ match.map_name || '地图资料暂缺' }}</strong><small>{{ match.hero_name || '英雄资料暂缺' }} · {{ mode(match.mode) }}</small></span><span class="ow-personal-score">{{ metric(match.team_score) }} : {{ metric(match.opponent_score) }}</span><time>{{ moment(match.started_at) }}</time><span aria-hidden="true">{{ expanded === match.id ? '−' : '＋' }}</span></button>
          <div v-if="expanded === match.id" class="ow-personal-details"><span>消灭<strong>{{ metric(match.kills) }}</strong></span><span>助攻<strong>{{ metric(match.assists) }}</strong></span><span>死亡<strong>{{ metric(match.deaths) }}</strong></span><span>伤害<strong>{{ metric(match.damage) }}</strong></span><span>治疗<strong>{{ metric(match.healing) }}</strong></span><p>本人的对局指标 · {{ match.source_season ? '战绩源赛季 ' + match.source_season : '来源未标注赛季' }} · 仅保存必要比分与地图信息。</p></div>
        </article></div>
        <div v-if="matches.length || offset" class="ow-personal-pagination"><button :disabled="loading || !offset" @click="page(-20)">上一页</button><span>第 {{ offset / 20 + 1 }} 页</span><button :disabled="loading || !hasMore" @click="page(20)">下一页</button></div>
      </template>
      <p v-else class="ow-personal-empty">同步已暂停，战绩暂不展示。你可以重新开启。</p>
    </template>
  </section>
</template>

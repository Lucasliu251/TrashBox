<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { api } from '../api'
import type { RadarSession, RadarStatus, RadarTarget, ResolvedTarget } from '../types'

const props = defineProps<{ token: string }>()
const emit = defineEmits<{ logout: [] }>()
/** 品牌回首页地址，跟随 Vite base（生产为 /radar/） */
const homeHref = import.meta.env.BASE_URL

const QUICK_TAGS = ['外挂', '高玩', '蠢猪', '可疑'] as const
type ServiceMedal = 'unknown' | 'yes' | 'no'
interface TargetDraft {
  alias: string
  tags: string[]
  manual_cs_level: string
  service_medal: ServiceMedal
  note: string
}

const emptyDraft = (): TargetDraft => ({
  alias: '',
  tags: [],
  manual_cs_level: '',
  service_medal: 'unknown',
  note: '',
})

const targets = ref<RadarTarget[]>([])
const session = ref<RadarSession | null>(null)
const loading = ref(true)
const scanning = ref(false)
const error = ref('')
const selectedTag = ref('')
const lastUpdated = ref<Date | null>(null)
const now = ref(Date.now())
const addOpen = ref(false)
const resolveValue = ref('')
const preview = ref<ResolvedTarget | null>(null)
const draft = reactive<TargetDraft>(emptyDraft())
const customTag = ref('')
const editingTarget = ref<RadarTarget | null>(null)
const editDraft = reactive<TargetDraft>(emptyDraft())
const editCustomTag = ref('')
const editSaving = ref(false)
let pollTimer: number | undefined
let clockTimer: number | undefined

const statusMeta: Record<RadarStatus, { label: string; tone: string }> = {
  in_match: { label: '疑似对局中', tone: 'danger' },
  in_cs2: { label: 'CS2 中', tone: 'warning' },
  online: { label: 'Steam 在线', tone: 'online' },
  offline: { label: '离线', tone: 'muted' },
  unknown: { label: '未知', tone: 'muted' },
}

const tags = computed(() => [...new Set(targets.value.flatMap(target => target.tags || []))])
const sameMatchCounts = computed(() => targets.value.reduce<Record<string, number>>((result, target) => {
  if (target.group_key) result[target.group_key] = (result[target.group_key] || 0) + 1
  return result
}, {}))
const filteredTargets = computed(() => selectedTag.value
  ? targets.value.filter(target => target.tags.includes(selectedTag.value))
  : targets.value)
const groups = computed(() => (['in_match', 'in_cs2', 'online', 'offline', 'unknown'] as RadarStatus[])
  .map(status => ({ ...statusMeta[status], status, items: filteredTargets.value.filter(target => (target.status || 'unknown') === status) }))
  .filter(group => group.items.length))
const remaining = computed(() => {
  if (!session.value) return ''
  const seconds = Math.max(0, Math.ceil((new Date(session.value.expires_at).getTime() - now.value) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})

async function loadTargets() {
  targets.value = await api.targets(props.token)
  lastUpdated.value = new Date()
}

async function loadSession() {
  session.value = await api.session(props.token)
}

async function snapshot() {
  scanning.value = true
  try {
    const result = await api.snapshot(props.token)
    targets.value = result.targets
    session.value = result.session
    lastUpdated.value = new Date()
  } finally {
    scanning.value = false
  }
}

async function initialize() {
  loading.value = true
  error.value = ''
  try {
    await loadTargets()
    await snapshot()
    await loadSession()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Radar 初始化失败'
    if (error.value.includes('401')) emit('logout')
  } finally {
    loading.value = false
  }
}

async function startSession() {
  scanning.value = true
  error.value = ''
  try {
    session.value = await api.startSession(props.token)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法启动扫描'
  } finally {
    scanning.value = false
  }
}

async function resolveTarget() {
  if (!resolveValue.value.trim()) return
  scanning.value = true
  error.value = ''
  try {
    preview.value = await api.resolve(props.token, resolveValue.value.trim())
    draft.alias = preview.value.personaname
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法解析 Steam 用户'
  } finally {
    scanning.value = false
  }
}

function toggleTag(tags: string[], tag: string) {
  const index = tags.indexOf(tag)
  if (index >= 0) tags.splice(index, 1)
  else if (tags.length < 20) tags.push(tag)
}

function isQuickTag(tag: string) {
  return (QUICK_TAGS as readonly string[]).includes(tag)
}

function addCustomTag(tags: string[], value: string) {
  const tag = value.trim()
  if (!tag || tags.includes(tag) || tags.length >= 20) return false
  tags.push(tag)
  return true
}

function commitCustomTag() {
  if (addCustomTag(draft.tags, customTag.value)) customTag.value = ''
}

function commitEditCustomTag() {
  if (addCustomTag(editDraft.tags, editCustomTag.value)) editCustomTag.value = ''
}

async function readClipboard() {
  try {
    resolveValue.value = await navigator.clipboard.readText()
    await resolveTarget()
  } catch {
    error.value = '浏览器未允许读取剪贴板，请手动粘贴。'
  }
}

async function addTarget() {
  if (!preview.value) return
  try {
    await api.addTarget(props.token, {
      steam_id: preview.value.steam_id,
      alias: draft.alias || null,
      tags: draft.tags,
      note: draft.note || null,
      manual_cs_level: draft.manual_cs_level === '' ? null : Number(draft.manual_cs_level),
      service_medal: draft.service_medal,
    })
    addOpen.value = false
    preview.value = null
    resolveValue.value = ''
    customTag.value = ''
    Object.assign(draft, emptyDraft())
    await snapshot()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '添加失败'
  }
}

async function removeTarget(target: RadarTarget) {
  if (!window.confirm(`确认将 ${target.alias || target.personaname || target.steam_id} 移出共享 Radar？`)) return
  await api.removeTarget(props.token, target.id)
  await loadTargets()
}

function openEditTarget(target: RadarTarget) {
  editingTarget.value = target
  editCustomTag.value = ''
  Object.assign(editDraft, {
    alias: target.alias || '',
    tags: [...(target.tags || [])],
    manual_cs_level: target.manual_cs_level == null ? '' : String(target.manual_cs_level),
    service_medal: target.service_medal || 'unknown',
    note: target.note || '',
  })
}

function closeEditTarget() {
  if (editSaving.value) return
  editingTarget.value = null
  editCustomTag.value = ''
}

async function saveEditTarget() {
  if (!editingTarget.value) return
  editSaving.value = true
  error.value = ''
  try {
    await api.updateTarget(props.token, editingTarget.value.id, {
      alias: editDraft.alias.trim() || null,
      tags: editDraft.tags,
      manual_cs_level: editDraft.manual_cs_level === '' ? null : Number(editDraft.manual_cs_level),
      service_medal: editDraft.service_medal,
      note: editDraft.note.trim() || null,
    })
    editingTarget.value = null
    await loadTargets()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '更新标注失败'
  } finally {
    editSaving.value = false
  }
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeEditTarget()
}

function formatClock(date: Date | null) {
  return date ? date.toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--'
}

function hours(minutes: number | null) {
  return minutes == null ? '未知' : Math.round(minutes / 60).toLocaleString('zh-CN')
}

function communityRipUrl(steamId: string) {
  return `https://steamcommunity.rip/profiles/${encodeURIComponent(steamId)}/`
}

onMounted(() => {
  void initialize()
  pollTimer = window.setInterval(() => Promise.all([loadTargets(), loadSession()]).catch(() => undefined), 5000)
  clockTimer = window.setInterval(() => { now.value = Date.now() }, 1000)
  window.addEventListener('keydown', onWindowKeydown)
})

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer)
  if (clockTimer) window.clearInterval(clockTimer)
  window.removeEventListener('keydown', onWindowKeydown)
})
</script>

<template>
  <main class="dashboard-shell">
    <header class="topbar">
      <a class="brand" :href="homeHref"><span class="brand-mark">TB</span><span>TRASHBOX</span></a>
      <div class="top-status"><span :class="['live-dot', { active: scanning || session }]" />{{ session ? `扫描中 ${remaining}` : 'RADAR STANDBY' }}</div>
      <button class="text-button" @click="emit('logout')">退出</button>
    </header>

    <section class="radar-hero">
      <div>
        <span class="kicker">PREMIER WATCH / SHARED INTELLIGENCE</span>
        <h1>CS2 <em>Radar</em></h1>
        <p>在点击匹配前，查看你们共同关注的玩家是否也刚好在线。</p>
      </div>
      <div class="hero-stats">
        <div><strong>{{ targets.length }}</strong><span>监控对象</span></div>
        <div><strong>{{ targets.filter(t => t.status === 'in_match').length }}</strong><span>疑似对局</span></div>
        <div><strong>{{ targets.filter(t => t.risk_signals?.length).length }}</strong><span>风险目标</span></div>
      </div>
    </section>

    <section class="command-bar">
      <div class="command-state">
        <span :class="['radar-pulse', { active: scanning || session }]" />
        <div><strong>{{ scanning ? '正在请求实时快照' : session ? '持续扫描正在运行' : '实时快照已就绪' }}</strong><small>最后刷新 {{ formatClock(lastUpdated) }}</small></div>
      </div>
      <button class="button primary compact" :disabled="scanning || !!session" @click="startSession">{{ session ? remaining : '开启 10 分钟扫描' }}</button>
      <button class="button outline compact" @click="addOpen = !addOpen">＋ 添加对象</button>
    </section>

    <div v-if="error" class="error-message wide">{{ error }}</div>

    <section v-if="addOpen" class="add-panel">
      <div class="panel-title"><div><span class="kicker">WATCHLIST</span><h2>添加监控对象</h2></div><button class="text-button" @click="addOpen = false">关闭</button></div>
      <div class="resolve-controls"><input v-model="resolveValue" placeholder="SteamID64、Profile URL 或 Vanity URL" @keyup.enter="resolveTarget" /><button class="button primary compact" @click="resolveTarget">解析</button><button class="button outline compact" @click="readClipboard">读取剪贴板</button></div>
      <div v-if="preview" class="resolved-profile">
        <img :src="preview.avatar_url || ''" alt="" />
        <div><strong>{{ preview.personaname }}</strong><code>{{ preview.steam_id }}</code></div>
        <div class="target-form">
          <label class="form-field"><span>备注名 <small>可选</small></span><input v-model="draft.alias" placeholder="例如：老熟人" /></label>
          <label class="form-field"><span>人工 CS 等级 <small>可选</small></span><input v-model="draft.manual_cs_level" type="number" min="0" max="100" placeholder="未知则留空" /></label>
          <label class="form-field"><span>服役勋章 <small>可选</small></span><select v-model="draft.service_medal"><option value="unknown">未知 / 不标注</option><option value="yes">有服役勋章</option><option value="no">无服役勋章</option></select></label>
          <label class="form-field"><span>补充说明 <small>可选</small></span><input v-model="draft.note" maxlength="500" placeholder="阵容、习惯或其他信息" /></label>
          <div class="form-field tag-field wide-input">
            <span>标签 <small>可多选，也可留空</small></span>
            <div class="tag-options"><button v-for="tag in QUICK_TAGS" :key="tag" type="button" :class="{ selected: draft.tags.includes(tag) }" @click="toggleTag(draft.tags, tag)">{{ tag }}</button></div>
            <div class="custom-tag-row"><input v-model="customTag" maxlength="30" placeholder="其他标签，回车创建" @keydown.enter.prevent="commitCustomTag" /><button type="button" @click="commitCustomTag">添加</button></div>
            <div v-if="draft.tags.some(tag => !isQuickTag(tag))" class="selected-tags"><button v-for="tag in draft.tags.filter(tag => !isQuickTag(tag))" :key="tag" type="button" @click="toggleTag(draft.tags, tag)">{{ tag }} ×</button></div>
          </div>
          <button class="button primary compact wide-input" @click="addTarget">加入共享 Radar</button>
        </div>
      </div>
    </section>

    <nav class="filters"><button :class="{ selected: !selectedTag }" @click="selectedTag = ''">全部</button><button v-for="tag in tags" :key="tag" :class="{ selected: selectedTag === tag }" @click="selectedTag = tag">{{ tag }}</button></nav>

    <section v-if="loading" class="empty-panel">正在建立 Radar 视图…</section>
    <section v-else-if="groups.length === 0" class="empty-panel"><strong>Radar 暂时是空的</strong><span>添加 Steam 个人资料后，这里会显示实时状态。</span></section>

    <section v-for="group in groups" :key="group.status" class="target-group">
      <header><span :class="['status-dot', group.tone]" /><h2>{{ group.label }}</h2><span>{{ group.items.length }}</span></header>
      <div class="target-grid">
        <article v-for="target in group.items" :key="target.id" class="player-card">
          <div class="player-head"><img :src="target.avatar_url || ''" alt="" /><div class="player-copy"><h3>{{ target.alias || target.personaname || target.steam_id }}</h3><p>{{ target.game_extra_info || '未公开具体游戏状态' }}</p></div><span :class="['presence', statusMeta[target.status || 'unknown'].tone]">{{ statusMeta[target.status || 'unknown'].label }}</span></div>
          <div class="signals"><span v-if="target.group_key && sameMatchCounts[target.group_key] > 1" class="danger">疑似同局 ×{{ sameMatchCounts[target.group_key] }}</span><span v-if="target.manual_cs_level != null && target.manual_cs_level < 40" class="danger">CS Lv.{{ target.manual_cs_level }}</span><span v-for="tag in target.tags" :key="tag">{{ tag }}</span></div>
          <div class="card-metrics"><div><strong>{{ hours(target.cs2_playtime_minutes) }}</strong><span>CS2 小时</span></div><div><strong :class="{ hot: target.risk_signals?.length }">{{ target.risk_signals?.length || 0 }}</strong><span>风险信号</span></div><div><strong class="time">{{ target.observed_at ? new Date(target.observed_at).toLocaleTimeString('zh-CN', { hour12: false }) : '未扫描' }}</strong><span>最近观测</span></div></div>
          <div v-if="target.risk_signals?.length" class="risk-list"><span v-for="signal in target.risk_signals" :key="signal.code" :class="signal.severity">{{ signal.label }}</span></div>
          <footer><span class="profile-links"><a v-if="target.profile_url" :href="target.profile_url" target="_blank" rel="noopener noreferrer">Steam 资料 ↗</a><a :href="communityRipUrl(target.steam_id)" target="_blank" rel="noopener noreferrer">CS 数据导航 ↗</a></span><span class="card-actions"><button @click="openEditTarget(target)">编辑标注</button><button @click="removeTarget(target)">移出 Radar</button></span></footer>
        </article>
      </div>
    </section>

    <footer class="page-footer"><span>OFFICIAL STEAM DATA ONLY</span><p>“疑似同局”仅来自相同公开服务器或大厅标识，不证明组排；未知资料不代表安全或作弊。</p></footer>
  </main>

  <Teleport to="body">
    <div v-if="editingTarget" class="modal-backdrop" role="presentation" @click.self="closeEditTarget">
      <section class="edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-target-title">
        <header class="modal-head">
          <div><span class="kicker">PLAYER ANNOTATION</span><h2 id="edit-target-title">编辑全部标注</h2><p>{{ editingTarget.alias || editingTarget.personaname || editingTarget.steam_id }}</p></div>
          <button class="modal-close" type="button" aria-label="关闭" @click="closeEditTarget">×</button>
        </header>
        <p class="optional-hint">所有字段均为可选项，留空不会阻止保存。</p>
        <form class="edit-form" @submit.prevent="saveEditTarget">
          <label class="form-field"><span>备注名 <small>可选</small></span><input v-model="editDraft.alias" maxlength="100" placeholder="给队友容易识别的名字" /></label>
          <label class="form-field"><span>人工 CS 等级 <small>可选</small></span><input v-model="editDraft.manual_cs_level" type="number" min="0" max="100" placeholder="未知则留空" /></label>
          <label class="form-field"><span>服役勋章 <small>可选</small></span><select v-model="editDraft.service_medal"><option value="unknown">未知 / 不标注</option><option value="yes">有服役勋章</option><option value="no">无服役勋章</option></select></label>
          <label class="form-field"><span>补充说明 <small>可选</small></span><textarea v-model="editDraft.note" maxlength="500" rows="4" placeholder="阵容、习惯或其他信息" /></label>
          <div class="form-field tag-field full-row">
            <span>标签 <small>可多选，也可留空</small></span>
            <div class="tag-options"><button v-for="tag in QUICK_TAGS" :key="tag" type="button" :class="{ selected: editDraft.tags.includes(tag) }" @click="toggleTag(editDraft.tags, tag)">{{ tag }}</button></div>
            <div class="custom-tag-row"><input v-model="editCustomTag" maxlength="30" placeholder="其他标签，回车创建" @keydown.enter.prevent="commitEditCustomTag" /><button type="button" @click="commitEditCustomTag">添加</button></div>
            <div v-if="editDraft.tags.some(tag => !isQuickTag(tag))" class="selected-tags"><button v-for="tag in editDraft.tags.filter(tag => !isQuickTag(tag))" :key="tag" type="button" @click="toggleTag(editDraft.tags, tag)">{{ tag }} ×</button></div>
          </div>
          <footer class="modal-actions full-row"><button class="button outline compact" type="button" :disabled="editSaving" @click="closeEditTarget">取消</button><button class="button primary compact" type="submit" :disabled="editSaving">{{ editSaving ? '保存中…' : '保存全部标注' }}</button></footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>

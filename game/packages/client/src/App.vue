<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { RoomSnapshot, ScoreEntry, ServerMessage } from '@trashbox/sniper-shared'
import { GameConnection, type ConnectionStatus } from './network'
import { readSettings, saveSettings, sensitivitySummary } from './settings'
import { getAuthSession, redirectToLogin, startGameSessionActivity } from './auth'

const GameCanvas = defineAsyncComponent(() => import('./components/GameCanvas.vue'))

const connection = new GameConnection()
const settings = reactive(readSettings())
const status = ref<ConnectionStatus>('closed')
const room = ref<RoomSnapshot | null>(null)
const error = ref('')
const joinCode = ref(new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '')
/** 首页链接跟随 Vite base，避免子路径部署时跳回站点根目录 */
const homeHref = import.meta.env.BASE_URL
const acknowledged = ref(sessionStorage.getItem('blackline.content-warning') === 'yes')
const copied = ref(false)
const showCredits = ref(false)

const ownPlayer = computed(() => room.value?.players.find(player => player.id === connection.playerId) ?? null)
const isHost = computed(() => room.value?.hostId === connection.playerId)
const summary = computed(() => sensitivitySummary(settings))
const allReady = computed(() => Boolean(room.value && room.value.players.length >= 2 && room.value.players.every(player => player.ready && player.connected)))
const inGame = computed(() => room.value?.phase === 'active' || room.value?.phase === 'round_result')
const sortedScores = computed<ScoreEntry[]>(() => room.value?.scores ?? [])
const compatibility = detectCompatibility()

let offMessage: () => void = () => undefined
let offStatus: () => void = () => undefined
let offActivity: () => void = () => undefined

function sessionExpired() {
  connection.close()
  redirectToLogin()
}

onMounted(async () => {
  offMessage = connection.onMessage(receive)
  offStatus = connection.onStatus(next => { status.value = next })
  try {
    if (!await getAuthSession()) { sessionExpired(); return }
    offActivity = startGameSessionActivity(sessionExpired)
    connection.connect()
  } catch {
    error.value = '登录服务暂时不可用，请刷新重试'
  }
})

onBeforeUnmount(() => {
  offMessage()
  offStatus()
  offActivity()
  connection.close()
})

function detectCompatibility() {
  const probe = document.createElement('canvas')
  return {
    webgl2: Boolean(probe.getContext('webgl2')),
    pointerLock: 'pointerLockElement' in document && 'requestPointerLock' in probe,
  }
}

function receive(message: ServerMessage) {
  if (message.type === 'room.state') room.value = message.payload
  else if (message.type === 'state.snapshot') room.value = message.payload.room
  else if (message.type === 'round.result') room.value = message.payload.room
  else if (message.type === 'session.left') {
    room.value = null
    history.replaceState({}, '', location.pathname)
  } else if (message.type === 'room.closed') {
    room.value = null
    error.value = message.payload.message
    history.replaceState({}, '', location.pathname)
  }
  else if (message.type === 'error') error.value = message.payload.message
}

function persist() {
  saveSettings(settings)
  error.value = ''
}

function createRoom() {
  persist()
  if (!acknowledged.value) return
  connection.createRoom(settings.name)
}

function joinRoom() {
  persist()
  if (!acknowledged.value || joinCode.value.length !== 6) return
  connection.joinRoom(joinCode.value, settings.name)
}

function ready() {
  connection.send({ type: 'room.ready', payload: { ready: !ownPlayer.value?.ready } })
}

function start() {
  connection.send({ type: 'room.start', payload: {} })
}

function leaveRoom() {
  if (isHost.value && !window.confirm('解散后所有成员都会返回首页，确定解散这个房间吗？')) return
  connection.leaveRoom()
}

function acknowledge() {
  acknowledged.value = true
  sessionStorage.setItem('blackline.content-warning', 'yes')
}

async function copyInvite() {
  if (!room.value) return
  const invite = `${location.origin}${location.pathname}?room=${room.value.code}`
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(invite)
  else {
    const field = document.createElement('textarea')
    field.value = invite
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    document.execCommand('copy')
    field.remove()
  }
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 1400)
}

function scoreRank(index: number) {
  return String(index + 1).padStart(2, '0')
}
</script>

<template>
  <main class="app-shell" :class="{ 'is-game': inGame }">
    <GameCanvas v-if="room && inGame" :connection="connection" :settings="settings" :room="room" />

    <template v-else>
      <nav class="topbar">
        <a class="brand" :href="homeHref" aria-label="BLACKLINE 首页">
          <i />
          <span>BLACKLINE<small>PRIVATE RANGE / 01</small></span>
        </a>
        <div class="topbar-status">
          <span :class="['status-dot', status]" />
          {{ status === 'open' ? '训练服务器在线' : status === 'connecting' ? '正在连接' : '连接中断' }}
        </div>
        <button class="text-button" type="button" @click="showCredits = true">CREDITS / 资源许可</button>
      </nav>

      <section v-if="!room" class="landing-grid">
        <div class="hero-copy">
          <span class="eyebrow">BROWSER-BASED MARKSMANSHIP PROTOCOL</span>
          <h1>一条封锁线。<br /><em>五个人的准星。</em></h1>
          <p class="hero-lead">一名狙击手控制终点，最多四名士兵借夜色与掩体突围。无需下载，房间码直达。</p>
          <div class="hero-stats">
            <div><b>128</b><span>SERVER HZ</span></div>
            <div><b>90</b><span>SECONDS</span></div>
            <div><b>2–5</b><span>PLAYERS</span></div>
          </div>
          <div class="route-diagram" aria-label="地图路线示意图">
            <span class="spawn">START</span>
            <i v-for="index in 9" :key="index" :class="`block b${index}`" />
            <span class="lane lane-a" /><span class="lane lane-b" /><span class="lane lane-c" />
            <span class="tower">SNIPER<br />+8M</span>
          </div>
        </div>

        <form class="control-card" @submit.prevent="createRoom">
          <div class="card-heading">
            <span>01 / CALIBRATION</span>
            <strong>校准你的输入</strong>
            <p>数值只保存在本机，用于将鼠标原始位移映射到视角角度。</p>
          </div>

          <label>
            <span>呼号</span>
            <input v-model="settings.name" maxlength="16" autocomplete="nickname" @change="persist" />
          </label>
          <div class="input-pair">
            <label><span>鼠标 DPI</span><input v-model.number="settings.dpi" type="number" min="100" max="32000" @change="persist" /></label>
            <label><span>CS2 灵敏度</span><input v-model.number="settings.sensitivity" type="number" min="0.01" max="10" step="0.01" @change="persist" /></label>
          </div>
          <label>
            <span>zoom_sensitivity_ratio_mouse</span>
            <input v-model.number="settings.zoomSensitivity" type="number" min="0.1" max="3" step="0.01" @change="persist" />
          </label>
          <div class="calibration-readout">
            <div><span>eDPI</span><b>{{ Math.round(summary.edpi) }}</b></div>
            <div><span>CM / 360°</span><b>{{ summary.cm360.toFixed(2) }}</b></div>
            <div><span>PRESET</span><b>AWP_2026_08</b></div>
          </div>
          <label class="toggle-row">
            <input v-model="settings.reducedViolence" type="checkbox" @change="persist" />
            <span><b>降低暴力表现</b><small>将断肢与血液替换为低刺激命中特效</small></span>
          </label>

          <div v-if="!compatibility.webgl2 || !compatibility.pointerLock" class="compat-error">
            当前浏览器缺少 {{ !compatibility.webgl2 ? 'WebGL2' : 'Pointer Lock' }}，不能进入严格训练模式。
          </div>
          <div v-if="error" class="compat-error">{{ error }}</div>

          <button class="primary-action" type="submit" :disabled="status !== 'open' || !compatibility.webgl2 || !compatibility.pointerLock">
            创建私人训练房
            <span>↗</span>
          </button>

          <div class="join-row">
            <input v-model="joinCode" maxlength="6" placeholder="输入 6 位房间码" aria-label="房间码" />
            <button type="button" :disabled="joinCode.length !== 6 || status !== 'open'" @click="joinRoom">加入</button>
          </div>
        </form>
      </section>

      <section v-else class="lobby-layout">
        <div class="lobby-main">
          <span class="eyebrow">PRIVATE SESSION / {{ room.code }}</span>
          <h1>{{ room.phase === 'match_result' ? '训练完成。' : '等待小队集结。' }}</h1>
          <p>{{ room.phase === 'match_result' ? '本场按总分、突围次数、突围用时与阻止用时排序。' : '每名玩家会依次担任一次狙击手；所有人准备后由房主启动。' }}</p>

          <div v-if="room.phase === 'match_result'" class="score-table">
            <div v-for="(score, index) in sortedScores" :key="score.playerId" class="score-row">
              <b>{{ scoreRank(index) }}</b>
              <strong>{{ score.name }}</strong>
              <span><small>总分</small>{{ score.duelWins }}</span>
              <span><small>突围</small>{{ score.runnerEscapes }}</span>
              <span><small>阻止</small>{{ score.sniperStops }}</span>
            </div>
          </div>

          <div v-else class="player-grid">
            <article v-for="(player, index) in room.players" :key="player.id" :class="{ ready: player.ready, offline: !player.connected }">
              <span>{{ String(index + 1).padStart(2, '0') }}</span>
              <div><strong>{{ player.name }}</strong><small>{{ player.id === room.hostId ? 'HOST / ' : '' }}{{ player.connected ? (player.ready ? 'READY' : 'CALIBRATING') : 'RECONNECTING' }}</small></div>
              <i />
            </article>
            <article v-for="index in 5 - room.players.length" :key="`empty-${index}`" class="empty">
              <span>--</span><div><strong>等待玩家</strong><small>OPEN SLOT</small></div><i />
            </article>
          </div>
        </div>

        <aside class="lobby-sidebar">
          <span class="eyebrow">INVITE CODE</span>
          <button class="room-code" type="button" @click="copyInvite">{{ room.code }}<small>{{ copied ? '链接已复制' : '点击复制邀请链接' }}</small></button>
          <dl>
            <div><dt>地图</dt><dd>NIGHT YARD / 56×12M</dd></div>
            <div><dt>轮换</dt><dd>{{ room.players.length }} 回合</dd></div>
            <div><dt>预设</dt><dd>CS2_AWP_2026_08</dd></div>
            <div><dt>服务器</dt><dd>{{ Math.round(connection.rttMs) }} MS</dd></div>
          </dl>
          <button class="ready-action" :class="{ active: ownPlayer?.ready }" type="button" @click="ready">
            {{ ownPlayer?.ready ? '取消准备' : '我已准备' }}
          </button>
          <button v-if="isHost" class="primary-action" type="button" :disabled="!allReady" @click="start">
            {{ room.phase === 'match_result' ? '开始下一场' : '启动训练' }}<span>↗</span>
          </button>
          <small v-if="isHost && !allReady" class="start-hint">至少两人，且全员在线准备后可启动</small>
          <button class="leave-action" type="button" @click="leaveRoom">
            {{ isHost ? '解散房间并返回' : '退出房间并返回' }}
          </button>
        </aside>
      </section>
    </template>

    <div v-if="!acknowledged" class="modal-backdrop">
      <section class="warning-modal">
        <span class="warning-mark">18</span>
        <div>
          <span class="eyebrow">CONTENT NOTICE / 内容提示</span>
          <h2>训练包含写实伤害反馈。</h2>
          <p>默认视觉包含血液粒子、断肢与死亡动画。你可以随时在校准面板启用“降低暴力表现”；该选项不改变服务器命中与移动规则。</p>
          <button type="button" class="primary-action" @click="acknowledge">了解并进入<span>↗</span></button>
        </div>
      </section>
    </div>

    <div v-if="showCredits" class="modal-backdrop" @click.self="showCredits = false">
      <section class="credits-modal">
        <button class="modal-close" type="button" @click="showCredits = false">×</button>
        <span class="eyebrow">OPEN ASSET REGISTER</span>
        <h2>资源与声明</h2>
        <p>当前可玩构建使用原创程序化几何与合成音效，不包含 Valve 模型、贴图、地图、标志或音频。“CS2 手感预设”仅描述校准目标，非 Valve 官方产品。</p>
        <p>后续高精度资产候选及其许可证、作者、修改方式统一记录在仓库的 <code>ATTRIBUTION.md</code>，并在引入前下载锁版、自托管与逐项复核。</p>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { api } from './api'
import RadarDashboard from './components/RadarDashboard.vue'

const token = ref(localStorage.getItem('trashbox_access_token') || '')
const qrUrl = ref('')
const loginError = ref('')
const loginBusy = ref(false)
const showMiniLogin = ref(false)
const scanMode = ref<'wechat' | 'mini'>('mini')
let pollTimer: number | undefined
let expiryTimer: number | undefined

function stopChallenge() {
  if (pollTimer) window.clearInterval(pollTimer)
  if (expiryTimer) window.clearTimeout(expiryTimer)
  pollTimer = undefined
  expiryTimer = undefined
}

/**
 * 写入登录态并清掉回调查询串。
 * 跳转目标使用 Vite base，避免挂在 /radar 时被打回站点根路径。
 *
 * @param value - 接口返回的访问令牌
 * @changelog
 * - 2026-08-22: replaceState 改为 import.meta.env.BASE_URL，支持路径反代
 */
function acceptToken(value: string) {
  token.value = value
  localStorage.setItem('trashbox_access_token', value)
  window.history.replaceState({}, '', import.meta.env.BASE_URL)
  stopChallenge()
}

async function poll(code: string) {
  try {
    const result = await api.pollChallenge(code)
    if (result.access_token) acceptToken(result.access_token)
  } catch (error) {
    if (error instanceof Error && error.message.includes('410')) {
      stopChallenge()
      qrUrl.value = ''
      loginError.value = '登录码已过期，请刷新后重试。'
    } else if (error instanceof Error) {
      loginError.value = error.message
    }
  }
}

async function beginQrLogin() {
  if (loginBusy.value) return
  stopChallenge()
  loginBusy.value = true
  loginError.value = ''
  qrUrl.value = ''
  try {
    const result = await api.createChallenge()
    scanMode.value = result.mini_program_qr ? 'wechat' : 'mini'
    qrUrl.value = result.mini_program_qr || await QRCode.toDataURL(result.qr_payload, {
        width: 260,
        margin: 2,
        color: { dark: '#121516', light: '#f0ede6' },
      })
    pollTimer = window.setInterval(() => poll(result.challenge_token), 1800)
    const expiresIn = new Date(result.expires_at).getTime() - Date.now()
    expiryTimer = window.setTimeout(() => {
      stopChallenge()
      qrUrl.value = ''
      loginError.value = '登录码已过期，请刷新后重试。'
    }, Math.max(0, expiresIn))
  } catch (error) {
    loginError.value = error instanceof Error && error.message.includes('502')
      ? '登录服务暂不可用，请稍后重试。'
      : error instanceof Error ? error.message : '无法创建登录码'
  } finally {
    loginBusy.value = false
  }
}

function logout() {
  localStorage.removeItem('trashbox_access_token')
  token.value = ''
  if (showMiniLogin.value) void beginQrLogin()
}

function toggleMiniLogin() {
  showMiniLogin.value = !showMiniLogin.value
  if (showMiniLogin.value) void beginQrLogin()
  else {
    stopChallenge()
    qrUrl.value = ''
    loginError.value = ''
  }
}

onMounted(async () => {
  const callbackCode = new URLSearchParams(window.location.search).get('code')
  if (callbackCode) {
    loginBusy.value = true
    await poll(callbackCode)
    loginBusy.value = false
  }
  if (!token.value && showMiniLogin.value) await beginQrLogin()
})

onBeforeUnmount(() => {
  stopChallenge()
})
</script>

<template>
  <RadarDashboard v-if="token" :token="token" @logout="logout" />
  <main v-else class="login-page">
    <section class="login-copy">
      <span class="kicker">TRASHBOX INTELLIGENCE</span>
      <h1>别让下一局<br><em>交给运气。</em></h1>
      <p>面向高分段固定时段玩家的共享 CS2 状态雷达。只读取 Steam 官方公开数据，帮你在点击匹配前多看一眼。</p>
      <div class="feature-line"><span>01</span> 实时 Presence 快照</div>
      <div class="feature-line"><span>02</span> 共享标注与风险信号</div>
      <div class="feature-line"><span>03</span> 10 分钟组队扫描窗口</div>
    </section>
    <section class="login-panel">
      <div class="panel-head"><span class="live-dot"></span><span>SECURE ACCESS</span></div>
      <h2>登录 Radar</h2>
      <p>已绑定 Steam 的成员可直接登录。</p>
      <a class="button primary" :href="api.steamLoginUrl">通过 Steam 登录</a>
      <div class="login-divider">或</div>
      <button class="button steam" @click="toggleMiniLogin">{{ showMiniLogin ? '收起扫码登录' : '扫码登录' }}</button>
      <template v-if="showMiniLogin">
        <p class="mini-login-hint">{{ scanMode === 'wechat' ? '用微信扫一扫，在小程序中确认登录。' : '请打开 TrashBox 小程序，在 Radar 页面点击“扫码登录”。' }}</p>
        <div class="qr-frame">
          <img v-if="qrUrl" :src="qrUrl" :alt="scanMode === 'wechat' ? '微信扫一扫登录码' : 'TrashBox 小程序登录码'" />
          <div v-else class="qr-loading">{{ loginBusy ? '生成中…' : '登录码不可用' }}</div>
        </div>
        <button class="button steam" :disabled="loginBusy" @click="beginQrLogin">刷新登录码</button>
        <small>登录码 5 分钟内有效，确认后立即失效。</small>
      </template>
      <div v-if="loginError" class="error-message">{{ loginError }}</div>
    </section>
  </main>
</template>

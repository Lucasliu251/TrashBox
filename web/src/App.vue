<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { api } from './api'
import RadarDashboard from './components/RadarDashboard.vue'

const token = ref(localStorage.getItem('trashbox_access_token') || '')
const qrUrl = ref('')
const challenge = ref('')
const loginError = ref('')
const loginBusy = ref(false)
let pollTimer: number | undefined

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
  if (pollTimer) window.clearInterval(pollTimer)
}

async function poll(code: string) {
  try {
    const result = await api.pollChallenge(code)
    if (result.access_token) acceptToken(result.access_token)
  } catch (error) {
    if (error instanceof Error && !error.message.includes('410')) loginError.value = error.message
  }
}

async function beginQrLogin() {
  loginBusy.value = true
  loginError.value = ''
  try {
    const result = await api.createChallenge()
    challenge.value = result.challenge_token
    qrUrl.value = await QRCode.toDataURL(result.qr_payload, {
      width: 260,
      margin: 2,
      color: { dark: '#121516', light: '#f0ede6' },
    })
    if (pollTimer) window.clearInterval(pollTimer)
    pollTimer = window.setInterval(() => poll(result.challenge_token), 1800)
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : '无法创建登录码'
  } finally {
    loginBusy.value = false
  }
}

function logout() {
  localStorage.removeItem('trashbox_access_token')
  token.value = ''
  void beginQrLogin()
}

onMounted(async () => {
  const callbackCode = new URLSearchParams(window.location.search).get('code')
  if (callbackCode) {
    loginBusy.value = true
    await poll(callbackCode)
    loginBusy.value = false
  }
  if (!token.value) await beginQrLogin()
})

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer)
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
      <h2>用 TrashBox 小程序确认</h2>
      <p>在 Radar 页面点击“扫码登录”，只有已注册成员可以进入。</p>
      <div class="qr-frame">
        <img v-if="qrUrl" :src="qrUrl" alt="TrashBox 登录二维码" />
        <div v-else class="qr-loading">{{ loginBusy ? '生成中…' : '二维码不可用' }}</div>
      </div>
      <button class="button primary" :disabled="loginBusy" @click="beginQrLogin">刷新登录码</button>
      <a class="button steam" :href="api.steamLoginUrl">通过已绑定 Steam 登录</a>
      <div v-if="loginError" class="error-message">{{ loginError }}</div>
      <small>登录码 5 分钟内有效，确认后立即失效。</small>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import {
  accountUrl, authRequest, AuthRequestError, getAuthSession, loginUrl,
  providerUrl, safeReturnTo, startSessionActivity,
  type AuthProvider, type AuthSession,
} from '../../shared/auth'

interface DeviceSession {
  id: string
  user_agent?: string | null
  created_at?: string
  last_seen_at?: string
  idle_expires_at?: string
  absolute_expires_at?: string
  is_current?: boolean
}
interface PendingMerge {
  id: string
  source: { id: string; display_name: string | null }
  target: { id: string; display_name: string | null }
  expires_at: string
}

const isAccount = /^\/account(?:\/|$)/.test(location.pathname)
const query = new URLSearchParams(location.search)
const returnTo = safeReturnTo(query.get('return_to'))
const session = ref<AuthSession | null>(null)
const providers = ref<AuthProvider[]>([])
const devices = ref<DeviceSession[]>([])
const pendingMerge = ref<PendingMerge | null>(null)
const mergeConsent = ref(false)
const loading = ref(true)
const error = ref('')
const accountError = ref('')
const success = ref('')
const busy = ref('')
const qrOpen = ref(false)
const qrBusy = ref(false)
const qrError = ref('')
const qrImage = ref('')
const qrNative = ref(false)
const qrNeedsReauth = ref(false)
let qrPollTimer: number | undefined
let qrExpiryTimer: number | undefined
let qrPolling = false
let stopActivity: (() => void) | undefined

const providerNames: Record<string, string> = { kook: 'KOOK', steam: 'Steam', wechat: '微信' }
const visibleProviders = computed(() => ['kook', 'steam', 'wechat'].map(id =>
  providers.value.find(provider => provider.id === id) || { id, label: providerNames[id]!, enabled: false },
))
const displayName = computed(() => session.value?.user.display_name || 'TrashBox 玩家')
const avatarUrl = computed(() => {
  try {
    const url = new URL(session.value?.user.avatar_url || '')
    return ['https:', 'http:'].includes(url.protocol) ? url.href : ''
  } catch { return '' }
})
const identityFor = (provider: string) => session.value?.identities.find(identity => identity.provider === provider)
const accountReturn = new URL(returnTo, location.origin).pathname === '/account' ? returnTo : accountUrl(returnTo)
const miniProvider = computed(() => providers.value.find(provider => provider.id === 'wechat_mini'))
const reauthProvider = computed(() => visibleProviders.value.find(provider => provider.enabled && identityFor(provider.id)))
const isCurrent = (device: DeviceSession) => device.is_current || device.id === session.value?.session.id

function formatDate(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

function deviceLabel(agent?: string | null) {
  if (!agent) return '浏览器会话'
  const platform = /iPhone|iPad/.test(agent) ? 'iOS' : /Android/.test(agent) ? 'Android'
    : /Macintosh|Mac OS/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : '浏览器'
  const browser = /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome'
    : /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : ''
  return `${platform}${browser ? ` · ${browser}` : ''}`
}

function callbackError() {
  const code = query.get('error')
  if (!code) return ''
  const errors: Record<string, string> = {
    provider_disabled: '该登录方式尚未配置，请选择其他方式。',
    provider_not_configured: '该登录方式尚未配置，请选择其他方式。',
    access_denied: '授权已取消，可以重新选择登录方式。',
    state_expired: '授权已过期，请重新登录。',
    invalid_state: '授权已过期，请重新登录。',
    identity_conflict: '此身份已关联另一个账号，请在下方确认是否合并。',
    merge_required: '此身份已关联另一个账号，请在下方确认是否合并。',
    auth_failed: '授权未完成，请重新尝试。',
    provider_unavailable: '登录平台暂不可用，请稍后重试。',
    reauth_required: '添加登录方式前，请重新验证当前账号。',
  }
  return errors[code] || '授权未完成，请重新尝试。'
}

function stopQr() {
  window.clearInterval(qrPollTimer)
  window.clearTimeout(qrExpiryTimer)
  qrPollTimer = undefined
  qrExpiryTimer = undefined
}

async function pollQr(token: string) {
  if (qrPolling) return
  qrPolling = true
  try {
    const result = await authRequest<{ status: string; pending_merge_id?: string }>(`/api/v1/web-auth/challenges/${encodeURIComponent(token)}`)
    if (result.status !== 'confirmed') return
    stopQr()
    session.value = await getAuthSession()
    if (!session.value) { qrError.value = '登录确认未完成，请刷新二维码。'; return }
    if (!isAccount) { window.location.replace(returnTo); return }
    providers.value = session.value.providers
    qrOpen.value = false
    qrImage.value = ''
    success.value = result.pending_merge_id ? '' : '小程序身份已绑定。'
    await loadAccountDetails()
  } catch (cause) {
    stopQr()
    qrError.value = cause instanceof AuthRequestError && cause.status === 410
      ? '二维码已过期或已使用，请刷新后重试。'
      : cause instanceof Error ? cause.message : '扫码确认暂不可用'
  } finally { qrPolling = false }
}

async function beginQr() {
  if (qrBusy.value) return
  stopQr()
  qrOpen.value = true
  qrBusy.value = true
  qrError.value = ''
  qrNeedsReauth.value = false
  qrImage.value = ''
  try {
    const result = await authRequest<{ challenge_token: string; qr_payload: string; mini_program_qr?: string | null; expires_at: string }>(
      `/api/v1/web-auth/challenges${isAccount ? '?kind=link' : ''}`, { method: 'POST' },
    )
    qrNative.value = !!result.mini_program_qr
    qrImage.value = result.mini_program_qr || await QRCode.toDataURL(result.qr_payload, {
      width: 240, margin: 2, color: { dark: '#111516', light: '#f4f2eb' },
    })
    qrPollTimer = window.setInterval(() => void pollQr(result.challenge_token), 1800)
    qrExpiryTimer = window.setTimeout(() => {
      stopQr()
      qrImage.value = ''
      qrError.value = '二维码已过期，请刷新后重试。'
    }, Math.max(0, Math.min(300_000, new Date(result.expires_at).getTime() - Date.now())))
  } catch (cause) {
    qrNeedsReauth.value = isAccount && cause instanceof AuthRequestError && cause.status === 409
    qrError.value = cause instanceof Error ? cause.message : '无法生成二维码'
  } finally { qrBusy.value = false }
}

function closeQr() {
  stopQr()
  qrOpen.value = false
  qrImage.value = ''
  qrError.value = ''
}

function handleError(cause: unknown, fallback: string) {
  if (cause instanceof AuthRequestError && cause.status === 401) {
    window.location.replace(loginUrl(isAccount ? accountReturn : returnTo))
    return
  }
  accountError.value = cause instanceof Error ? cause.message : fallback
}

async function loadAccountDetails() {
  accountError.value = ''
  const result = await Promise.allSettled([
    authRequest<{ sessions: DeviceSession[] } | DeviceSession[]>('/api/v1/auth/sessions'),
    authRequest<{ pending: PendingMerge | null }>('/api/v1/auth/merge/pending'),
  ])
  const deviceResult = result[0]
  if (deviceResult.status === 'fulfilled') {
    devices.value = Array.isArray(deviceResult.value) ? deviceResult.value : deviceResult.value.sessions || []
  } else handleError(deviceResult.reason, '登录设备加载失败')
  const mergeResult = result[1]
  if (mergeResult.status === 'fulfilled') pendingMerge.value = mergeResult.value.pending
  else handleError(mergeResult.reason, '账号合并信息加载失败')
}

async function initialize() {
  loading.value = true
  error.value = ''
  try {
    session.value = await getAuthSession()
    if (isAccount && !session.value) {
      window.location.replace(loginUrl(accountReturn))
      return
    }
    if (!isAccount && session.value) {
      window.location.replace(query.has('error')
        ? `${accountReturn}${accountReturn.includes('?') ? '&' : '?'}error=${encodeURIComponent(query.get('error') || 'auth_failed')}`
        : returnTo)
      return
    }
    if (session.value) {
      providers.value = session.value.providers
      stopActivity?.()
      stopActivity = startSessionActivity(() => window.location.replace(loginUrl(isAccount ? accountReturn : returnTo)))
    } else {
      const available = await authRequest<{ providers: AuthProvider[] }>('/api/v1/auth/providers')
      providers.value = available.providers || []
    }
    if (isAccount) await loadAccountDetails()
    error.value = callbackError()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法连接登录服务'
  } finally { loading.value = false }
}

async function logout(all = false) {
  if (busy.value) return
  busy.value = all ? 'logout-all' : 'logout'
  accountError.value = ''
  try {
    await authRequest(`/api/v1/auth/logout${all ? '?all=1' : ''}`, { method: 'POST' })
    window.location.replace(loginUrl(returnTo))
  } catch (cause) { handleError(cause, '退出失败，请重试') }
  finally { busy.value = '' }
}

async function revoke(device: DeviceSession) {
  if (busy.value) return
  busy.value = device.id
  accountError.value = ''
  try {
    await authRequest(`/api/v1/auth/sessions/${encodeURIComponent(device.id)}/revoke`, { method: 'POST' })
    if (isCurrent(device)) {
      window.location.replace(loginUrl(returnTo))
      return
    }
    devices.value = devices.value.filter(item => item.id !== device.id)
    success.value = '该设备已退出登录。'
  } catch (cause) { handleError(cause, '设备退出失败，请重试') }
  finally { busy.value = '' }
}

async function confirmMerge() {
  if (!pendingMerge.value || !mergeConsent.value || busy.value) return
  busy.value = 'merge'
  accountError.value = ''
  try {
    await authRequest('/api/v1/auth/merge/confirm', {
      method: 'POST', body: JSON.stringify({ id: pendingMerge.value.id }),
    })
    session.value = await getAuthSession()
    if (!session.value) { window.location.replace(loginUrl(accountReturn)); return }
    providers.value = session.value.providers
    pendingMerge.value = null
    mergeConsent.value = false
    success.value = '账号已合并，已验证的登录方式现在使用同一账号。'
    await loadAccountDetails()
  } catch (cause) { handleError(cause, '账号合并失败，请重试') }
  finally { busy.value = '' }
}

onMounted(() => { document.title = `TrashBox · ${isAccount ? '账号' : '登录'}`; void initialize() })
onBeforeUnmount(() => { stopActivity?.(); stopQr() })
</script>

<template>
  <div class="auth-shell" :class="{ 'account-shell': isAccount }">
    <header class="auth-header">
      <span class="brand"><span class="brand-mark">TB</span>TRASHBOX</span>
      <span class="header-caption">{{ isAccount ? '账号管理' : '统一账号' }}</span>
    </header>

    <main v-if="loading" class="state-screen" aria-live="polite"><span class="spinner"></span><p>正在确认登录状态…</p></main>

    <main v-else-if="!isAccount" class="login-layout">
      <section class="login-intro">
        <span class="eyebrow">YOUR TRASHBOX ACCOUNT</span>
        <h1>一起开局。<br><em>从这里开始。</em></h1>
        <p>选择熟悉的账号，登录 TrashBox。</p>
        <div class="intro-note"><span class="note-mark">↗</span><div><strong>一个账号，多种登录方式</strong><p>登录后可在账号页绑定 Steam、KOOK 或微信，下次任选已绑定方式登录。</p></div></div>
      </section>
      <section class="login-card" aria-labelledby="login-title">
        <span class="card-kicker"><span class="status-dot"></span>TRASHBOX ACCESS</span>
        <h2 id="login-title">登录 / 注册</h2>
        <p class="card-description">首次授权会自动创建账号。</p>
        <p v-if="error" class="notice error" role="alert">{{ error }}</p>
        <template v-if="providers.length">
          <template v-for="provider in visibleProviders" :key="provider.id">
            <a v-if="provider.enabled" class="provider-button" :class="{ recommended: provider.id === 'kook' }" :href="providerUrl(provider.id, 'login', returnTo)">
              <span class="provider-icon" :class="provider.id">{{ provider.id === 'kook' ? 'K' : provider.id === 'steam' ? 'S' : '微' }}</span>
              <span>通过 {{ provider.label }} 继续</span><small v-if="provider.id === 'kook'">推荐</small><span class="arrow">→</span>
            </a>
            <button v-else class="provider-button disabled" disabled><span class="provider-icon" :class="provider.id">{{ provider.id === 'kook' ? 'K' : provider.id === 'steam' ? 'S' : '微' }}</span><span>{{ provider.label }}</span><small>{{ provider.disabled_reason || '尚未配置' }}</small></button>
          </template>
        </template>
        <button v-else class="button primary" @click="initialize">重新连接登录服务</button>
        <template v-if="miniProvider?.enabled">
          <button class="mini-login-toggle text-button" @click="qrOpen ? closeQr() : beginQr()">{{ qrOpen ? '收起小程序扫码' : '已有小程序账号？扫码登录' }}</button>
          <section v-if="qrOpen" class="qr-login" aria-label="小程序扫码登录">
            <p>{{ qrNative ? '使用微信扫一扫，在 TrashBox 小程序中确认。' : '打开 TrashBox 小程序，在 Radar 页面点击“扫码登录”后扫描此码。' }}</p>
            <div class="qr-frame"><img v-if="qrImage" :src="qrImage" alt="TrashBox 小程序登录二维码" /><span v-else>{{ qrBusy ? '正在生成…' : '二维码不可用' }}</span></div>
            <p v-if="qrError" class="notice error" role="alert">{{ qrError }}</p>
            <button class="text-button" :disabled="qrBusy" @click="beginQr">刷新二维码</button><small>5 分钟内有效，仅在发起扫码的浏览器生效。</small>
          </section>
        </template>
        <p v-if="session" class="signed-in-note">当前已登录为 {{ displayName }}。<a :href="accountReturn">管理账号</a></p>
        <p class="login-footnote">授权时请核对账号。绑定其他登录方式需要在已登录状态下完成验证。</p>
      </section>
    </main>

    <main v-else-if="session" class="account-layout">
      <div class="account-heading"><div><span class="eyebrow">ACCOUNT</span><h1>我的账号</h1></div><a class="button secondary compact" :href="returnTo">返回原页面 ↗</a></div>
      <p v-if="error" class="notice error" role="alert">{{ error }}</p>
      <p v-if="accountError" class="notice error" role="alert">{{ accountError }}</p>
      <p v-if="success" class="notice success" role="status">{{ success }}</p>

      <section class="profile-card">
        <img v-if="avatarUrl" class="avatar" :src="avatarUrl" alt="" referrerpolicy="no-referrer" @error="($event.target as HTMLImageElement).style.display = 'none'" />
        <span v-else class="avatar avatar-placeholder">{{ displayName.slice(0, 1).toUpperCase() }}</span>
        <div class="profile-copy"><h2>{{ displayName }}</h2><span>TrashBox ID</span><code>{{ session.user.id }}</code></div>
        <span class="signed-in-badge"><span class="status-dot"></span>已登录</span>
      </section>

      <section v-if="pendingMerge" class="section-card merge-card" aria-labelledby="merge-title">
        <span class="eyebrow">需要确认</span><h2 id="merge-title">此登录身份已有账号</h2>
        <p>验证的身份属于“{{ pendingMerge.target.display_name || '另一个 TrashBox 账号' }}”。确认后将与当前账号“{{ pendingMerge.source.display_name || displayName }}”合并，两个账号已绑定的登录方式将归入同一账号。</p>
        <p>合并会保留原有业务数据与身份记录。请确认两个账号都属于你。</p>
        <small class="muted">本次验证有效至 {{ formatDate(pendingMerge.expires_at) }}</small>
        <label class="consent"><input v-model="mergeConsent" type="checkbox" /><span>我确认这两个账号都属于我，并同意合并账号。</span></label>
        <button class="button primary" :disabled="!mergeConsent || !!busy" @click="confirmMerge">{{ busy === 'merge' ? '正在合并…' : '确认合并账号' }}</button>
      </section>

      <section class="section-card" aria-labelledby="identities-title">
        <div class="section-heading"><div><h2 id="identities-title">登录方式</h2><p>绑定为可选项。已绑定方式都可登录这个账号。</p></div></div>
        <div v-for="provider in visibleProviders" :key="provider.id" class="identity-row">
          <span class="provider-icon" :class="provider.id">{{ provider.id === 'kook' ? 'K' : provider.id === 'steam' ? 'S' : '微' }}</span>
          <div class="identity-copy"><strong>{{ provider.label }}</strong><span>{{ identityFor(provider.id)?.label || (identityFor(provider.id) ? '已绑定' : provider.enabled ? '未绑定' : '尚未配置') }}</span><code v-if="identityFor(provider.id)">{{ identityFor(provider.id)?.subject }}</code></div>
          <span v-if="identityFor(provider.id)" class="bound-badge">已绑定</span>
          <a v-else-if="provider.enabled" class="button secondary compact" :href="providerUrl(provider.id, 'link', accountReturn)">绑定</a>
          <span v-else class="muted disabled-label">暂不可用</span>
        </div>
        <div v-if="miniProvider?.enabled || identityFor('wechat_mini')" class="identity-row">
          <span class="provider-icon wechat">微</span><div class="identity-copy"><strong>微信小程序</strong><span>{{ identityFor('wechat_mini')?.label || '可绑定已有 TrashBox 小程序账号' }}</span><code v-if="identityFor('wechat_mini')">{{ identityFor('wechat_mini')?.subject }}</code></div>
          <span v-if="identityFor('wechat_mini')" class="bound-badge">已绑定</span><button v-else class="button secondary compact" :disabled="qrBusy" @click="qrOpen ? closeQr() : beginQr()">{{ qrOpen ? '收起' : '扫码绑定' }}</button>
        </div>
        <section v-if="qrOpen" class="qr-login qr-account" aria-label="小程序身份绑定">
          <p>{{ qrNative ? '使用微信扫一扫，在 TrashBox 小程序中确认身份。' : '打开 TrashBox 小程序，在 Radar 页面点击“扫码登录”后扫描此码。' }}</p>
          <div class="qr-frame"><img v-if="qrImage" :src="qrImage" alt="TrashBox 小程序身份绑定二维码" /><span v-else>{{ qrBusy ? '正在生成…' : '二维码不可用' }}</span></div>
          <p v-if="qrError" class="notice error" role="alert">{{ qrError }}</p><button class="text-button" :disabled="qrBusy" @click="beginQr">刷新二维码</button><small>身份已有账号时，会在此页面请求确认合并。</small>
          <p v-if="qrNeedsReauth && reauthProvider"><a class="button secondary compact" :href="providerUrl(reauthProvider.id, 'reauth', accountReturn)">重新验证当前账号</a></p>
          <small v-else-if="qrNeedsReauth">请退出当前设备，再通过原登录方式登录后绑定。</small>
        </section>
      </section>

      <section class="section-card" aria-labelledby="devices-title">
        <div class="section-heading"><div><h2 id="devices-title">登录设备</h2><p>可让不再使用的设备立即退出。</p></div><button class="text-button" :disabled="!!busy" @click="loadAccountDetails">刷新</button></div>
        <p v-if="!devices.length" class="muted">暂无设备记录。</p>
        <div v-for="device in devices" :key="device.id" class="device-row">
          <span class="device-symbol">▣</span><div class="device-copy"><strong>{{ deviceLabel(device.user_agent) }}<small v-if="isCurrent(device)">当前设备</small></strong><span>最近使用 {{ formatDate(device.last_seen_at || device.created_at) }}</span></div>
          <button class="text-button danger" :disabled="!!busy" @click="revoke(device)">{{ busy === device.id ? '正在退出…' : '退出' }}</button>
        </div>
        <div class="logout-actions"><button class="button secondary compact" :disabled="!!busy" @click="logout()">退出当前设备</button><button class="text-button danger" :disabled="!!busy" @click="logout(true)">退出所有设备</button></div>
      </section>
    </main>

    <main v-else class="state-screen"><p class="notice error" role="alert">{{ error || '无法读取账号信息' }}</p><button class="button primary" @click="initialize">重试</button></main>
    <footer class="auth-footer"><span>TRASHBOX</span><span>账号由你掌控。</span></footer>
  </div>
</template>

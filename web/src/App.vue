<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { authRequest, getAuthSession, redirectToLogin, startSessionActivity, type AuthSession } from '../../shared/auth'
import RadarDashboard from './components/RadarDashboard.vue'

const session = ref<AuthSession | null>(null)
const loading = ref(true)
const error = ref('')
let stopActivity: (() => void) | undefined

async function initialize() {
  loading.value = true
  error.value = ''
  try {
    session.value = await getAuthSession()
    if (!session.value) { redirectToLogin(); return }
    stopActivity?.()
    stopActivity = startSessionActivity(() => redirectToLogin())
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '登录服务暂不可用' }
  finally { loading.value = false }
}

async function logout() {
  try {
    await authRequest('/api/v1/auth/logout', { method: 'POST' })
    session.value = null
    redirectToLogin()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '退出失败，请重试' }
}

onMounted(() => void initialize())
onBeforeUnmount(() => stopActivity?.())
</script>

<template>
  <template v-if="session"><div v-if="error" class="error-message wide" role="alert">{{ error }}</div><RadarDashboard @logout="logout" /></template>
  <main v-else class="session-gate" aria-live="polite"><strong>TrashBox Radar</strong><p>{{ loading ? '正在确认登录状态…' : error || '正在前往登录…' }}</p><button v-if="error" class="button outline compact" @click="initialize">重试</button></main>
</template>

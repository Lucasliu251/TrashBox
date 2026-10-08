<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getAuthSession, redirectToLogin, startSessionActivity, type AuthSession } from '../../shared/auth'
import CommunityApp from './CommunityApp.vue'

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

onMounted(() => void initialize())
onBeforeUnmount(() => stopActivity?.())
</script>

<template>
  <CommunityApp v-if="session" :account-display-name="session.user.display_name || '我的账号'" :steam-id="session.user.steam_id" />
  <main v-else class="session-gate" aria-live="polite"><strong>TrashBox</strong><p>{{ loading ? '正在确认登录状态…' : error || '正在前往登录…' }}</p><button v-if="error" @click="initialize">重试</button></main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { RoomSnapshot } from '@trashbox/sniper-shared'
import { GameEngine, type RuntimeInfo } from '../game/GameEngine'
import type { GameConnection } from '../network'
import type { TrainingSettings } from '../settings'

const props = defineProps<{
  connection: GameConnection
  settings: TrainingSettings
  room: RoomSnapshot
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const runtime = reactive<RuntimeInfo>({
  pointerLocked: false,
  rawInput: false,
  role: 'spectator',
  life: 'spectator',
  health: 0,
  ammo: 0,
  reserveAmmo: 0,
  scopeLevel: 0,
  roundTimeMs: 0,
  velocity: 0,
  hitText: '',
})
let engine: GameEngine | null = null

onMounted(() => {
  if (!canvas.value) return
  engine = new GameEngine({
    canvas: canvas.value,
    connection: props.connection,
    settings: props.settings,
    onRuntime: state => Object.assign(runtime, state),
  })
})

onBeforeUnmount(() => engine?.dispose())

function enter() {
  void engine?.requestPointerLock()
}
</script>

<template>
  <section class="game-shell">
    <canvas ref="canvas" class="game-canvas" aria-label="BLACKLINE 三维训练场" />

    <div class="game-vignette" />
    <div v-if="runtime.scopeLevel" class="scope-mask" :class="`scope-${runtime.scopeLevel}`">
      <span class="scope-line scope-line-x" />
      <span class="scope-line scope-line-y" />
      <span class="scope-dot" />
    </div>
    <div v-else class="crosshair" :style="{ '--spread': `${Math.min(22, 4 + runtime.velocity * 3)}px` }">
      <i v-for="index in 4" :key="index" />
    </div>

    <header class="combat-header">
      <div>
        <span class="eyebrow">ROUND {{ (room.round?.index ?? 0) + 1 }} / {{ room.players.length }}</span>
        <strong>{{ runtime.role === 'sniper' ? 'OVERWATCH / 狙击手' : 'BREAKOUT / 突围者' }}</strong>
      </div>
      <time>{{ Math.ceil(runtime.roundTimeMs / 1000).toString().padStart(2, '0') }}</time>
      <div class="network-state">
        <span :class="{ good: runtime.rawInput }">RAW {{ runtime.rawInput ? 'ON' : 'FALLBACK' }}</span>
        <b>{{ Math.round(connection.rttMs) }} MS</b>
      </div>
    </header>

    <div v-if="room.round?.paused" class="status-banner warning">狙击手断线 · 回合暂停 15 秒等待重连</div>
    <div v-else-if="room.phase === 'round_result'" class="status-banner">本回合结束 · 正在轮换狙击手</div>
    <div v-if="runtime.hitText" class="hit-confirm">{{ runtime.hitText }}</div>

    <aside class="health-panel">
      <span class="eyebrow">STATUS</span>
      <strong>{{ runtime.health }} <small>HP</small></strong>
      <div class="health-meter"><i :style="{ width: `${runtime.health}%` }" /></div>
      <small v-if="runtime.role === 'runner'">WASD 移动 · SHIFT 静步 · CTRL 蹲伏 · SPACE 跳跃</small>
      <small v-else>固定射击位 · 鼠标瞄准 · 无移动输入</small>
    </aside>

    <aside v-if="runtime.role === 'sniper'" class="weapon-panel">
      <span class="eyebrow">BOLT ACTION / 7.62</span>
      <strong>{{ runtime.ammo }}<small>/ {{ runtime.reserveAmmo }}</small></strong>
      <p>右键倍率 · R 装填 · 左键射击</p>
    </aside>

    <button v-if="!runtime.pointerLocked" class="capture-input" type="button" @click="enter">
      <span>{{ room.phase === 'active' ? '点击接管鼠标' : '下一回合即将开始' }}</span>
      <small>ESC 释放 · 浏览器需允许 Pointer Lock</small>
    </button>
  </section>
</template>

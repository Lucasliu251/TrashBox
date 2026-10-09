<script setup lang="ts">
import kook from '../assets/branding/kook.png'
import steam from '../assets/branding/steam.png'
import wechat from '../assets/branding/wechat.png'
import cs2 from '../assets/branding/cs2.png'
import ow from '../assets/branding/ow.png'
import trashbox from '../assets/branding/trashbox.png'
import battlenet from '../assets/branding/battlenet.png'

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 28 })
const images: Record<string, string> = { kook, steam, wechat, cs2, ow, trashbox, battlenet, wechat_mini: trashbox }
</script>

<template>
  <span class="brand-icon" :class="'brand-icon--' + props.name" :style="{ '--brand-icon-size': props.size + 'px' }" aria-hidden="true">
    <img v-if="images[props.name]" :src="images[props.name]" alt="" draggable="false" />
    <svg v-else viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="11" stroke="currentColor" stroke-width="2"/><ellipse cx="16" cy="16" rx="5" ry="11" stroke="currentColor" stroke-width="1.7" transform="rotate(35 16 16)"/><path d="M6 12c7 7 13 8 20 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
  </span>
</template>

<style scoped>
.brand-icon{display:inline-flex;align-items:center;justify-content:center;width:var(--brand-icon-size);height:var(--brand-icon-size);flex:0 0 var(--brand-icon-size);border-radius:calc(var(--brand-icon-size)*.23);overflow:hidden;vertical-align:middle;line-height:0;isolation:isolate}
.brand-icon img,.brand-icon svg{display:block;width:100%;height:100%;object-fit:contain}
.brand-icon--ow{border-radius:50%;background:#fff;padding:2px}
.brand-icon--trashbox,.brand-icon--wechat_mini{background:#fff;padding:2px}
.brand-icon--battlenet{background:transparent;color:#fff}
</style>

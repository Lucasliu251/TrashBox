<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ src?: string | null; name: string }>()
const failed = ref(false)
watch(() => props.src, () => { failed.value = false })
</script>

<template>
  <span class="ow-portrait" :class="{ 'ow-portrait-fallback': failed || !src }">
    <img v-if="src && !failed" :src="src" :alt="name" loading="lazy" decoding="async" @error="failed = true" />
    <span v-else role="img" :aria-label="`${name}头像暂不可用`">{{ name.slice(0, 1) }}</span>
  </span>
</template>

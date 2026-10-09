<script setup lang="ts">
withDefaults(defineProps<{ name?: string; size?: number }>(), { name: 'arrow', size: 18 })
</script>
<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ui-icon">
    <template v-if="name === 'search'"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></template>
    <path v-else-if="name === 'external'" d="M13 4h7v7M20 4 10 14M9 4H4v16h16v-5"/>
    <path v-else-if="name === 'close'" d="m6 6 12 12M6 18 18 6"/>
    <path v-else d="M4 12h16m-6-6 6 6-6 6"/>
  </svg>
</template>
<style scoped>.ui-icon{display:inline-block;flex-shrink:0;vertical-align:middle}</style>

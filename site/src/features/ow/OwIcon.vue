<script setup lang="ts">
withDefaults(defineProps<{ name?: string; size?: number }>(), { name: 'arrow', size: 20 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true" class="ow-icon">
    <template v-if="name === 'mark'">
      <path d="M5.3 5.3a9.5 9.5 0 0 1 13.4 0" stroke="#f59a23" stroke-width="3.6" />
      <path d="M3.8 7.4a9.4 9.4 0 1 0 16.4 0" stroke="currentColor" stroke-width="3.5" />
      <path d="M12 8v6l-5 4M12 14l5 4" stroke="currentColor" stroke-width="3" stroke-linejoin="round" />
    </template>
    <path v-else-if="name === 'tank'" d="M12 2.8 20 6v6.3c0 4.3-4.8 7.6-8 9-3.2-1.4-8-4.7-8-9V6l8-3.2Z" fill="currentColor" />
    <template v-else-if="name === 'damage'">
      <path d="M5 4.5 7 2l2 2.5V21H5V4.5ZM10 4.5 12 2l2 2.5V21h-4V4.5ZM15 4.5 17 2l2 2.5V21h-4V4.5Z" fill="currentColor" />
      <path d="M5 15h14" stroke="white" stroke-width="1.3" />
    </template>
    <path v-else-if="name === 'support'" d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z" fill="currentColor" />
    <template v-else-if="name === 'search'">
      <circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" stroke-width="1.8" />
      <path d="m16 16 4.2 4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </template>
    <template v-else-if="name === 'up' || name === 'down'">
      <path :d="name === 'up' ? 'M12 20V4m-6 6 6-6 6 6' : 'M12 4v16m-6-6 6 6 6-6'" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <template v-else-if="name === 'adjust'">
      <path d="M4 7h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <circle cx="9" cy="7" r="3" fill="currentColor" />
      <circle cx="15" cy="17" r="3" fill="currentColor" />
    </template>
    <path v-else-if="name === 'arrow'" d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    <path v-else-if="name === 'external'" d="M13 4h7v7M20 4 10 14M9 4H4v16h16v-5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
    <path v-else-if="name === 'close'" d="m6 6 12 12M6 18 18 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    <path v-else-if="name === 'refresh'" d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 14-2l1 2M4 16l1 2a8 8 0 0 0 14-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    <template v-else-if="name === 'trophy'">
      <path d="M7 3h10v7a5 5 0 0 1-10 0V3ZM7 5H3v3a5 5 0 0 0 5 5m9-8h4v3a5 5 0 0 1-5 5M12 15v5m-4 1h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <template v-else-if="name === 'flame'">
      <path d="M13 2c1 5-4 6-2 10 2-1 4-3 4-5 5 4 6 8 3 12-3 4-10 3-12-1C2 10 9 8 13 2Z" fill="currentColor" />
    </template>
    <template v-else-if="name === 'ban'">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8" />
      <path d="m6 6 12 12" stroke="currentColor" stroke-width="1.8" />
    </template>
    <template v-else-if="name === 'info'">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7" />
      <path d="M12 11v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <circle cx="12" cy="7" r="1.1" fill="currentColor" />
    </template>
    <path v-else-if="name === 'grid'" d="M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z" fill="currentColor" />
    <path v-else-if="name === 'chevron'" d="m8 5 7 7-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>

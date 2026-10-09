<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TacticalHero } from './tactics'
import { matchesHero } from './tactics'
import { ROLE_NAMES } from './tactics-data'
import OwPortrait from './OwPortrait.vue'
import UiIcon from '../../../../shared/components/UiIcon.vue'

const props = defineProps<{ heroes: TacticalHero[]; label: string; excluded?: string[] }>()
const emit = defineEmits<{ select: [id: string] }>()
const query = ref('')
const options = computed(() => props.heroes.filter(hero => matchesHero(hero, query.value)))
function choose(id: string) { if (!props.excluded?.includes(id)) emit('select', id) }
</script>

<template>
  <div class="tactic-picker">
    <label class="tactic-search"><UiIcon name="search" :size="20"/><input v-model="query" :aria-label="label" placeholder="英雄名称 / 英文 / 常用简称" autocomplete="off" @keydown.enter.prevent="options.length === 1 && choose(options[0]!.id)" /><button v-if="query" type="button" aria-label="清空英雄搜索" @click="query = ''">×</button></label>
    <div class="tactic-picker-grid" :aria-label="label + '结果'">
      <button v-for="hero in options" :key="hero.id" type="button" :disabled="excluded?.includes(hero.id)" :aria-label="'选择' + hero.name" @click="choose(hero.id)">
        <OwPortrait :src="hero.avatarUrl" :name="hero.name" /><span><strong>{{ hero.name }}</strong><small>{{ hero.role ? ROLE_NAMES[hero.role] : '职责待确认' }}<i v-if="!hero.assessed"> · 克制数据待收录</i></small></span><b v-if="excluded?.includes(hero.id)">已选</b>
      </button>
    </div>
    <p v-if="!options.length" class="tactic-empty">没有找到该英雄，请尝试官网名称或英文 ID。</p>
  </div>
</template>

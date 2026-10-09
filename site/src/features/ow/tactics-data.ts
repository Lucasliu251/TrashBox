/** Base-kit styles for a small, explicitly heuristic composition bonus; counters come from the sourced table. */
import type { OwRole } from './types'

export type PlayStyle = 'dive' | 'brawl' | 'poke'
export interface HeroMechanics {
  role: OwRole
  style: PlayStyle
  tags: string[]
  aliases?: string[]
}
export const TACTICS_VERSION = '社区克制表 · 核对于 2026-10-09'
export const ROLE_NAMES: Record<OwRole, string> = { '1': '输出', '2': '重装', '3': '支援' }
export const ROLE_LIMITS: Record<OwRole, number> = { '1': 2, '2': 1, '3': 2 }
const profile = (role: OwRole, style: PlayStyle, tags: string[], aliases: string[] = []): HeroMechanics => ({ role, style, tags, aliases })

// These are author-maintained base-kit classifications. New heroes are not inferred from their names.
export const MECHANICS: Record<string, HeroMechanics> = {
  dva: profile('2', 'dive', ['matrix', 'mobile'], ['d.va', 'd va', '小dva']),
  winston: profile('2', 'dive', ['beam', 'mobile', 'barrier'], ['猩猩']),
  sigma: profile('2', 'poke', ['matrix', 'barrier']),
  reinhardt: profile('2', 'brawl', ['barrier', 'close'], ['大锤']),
  zarya: profile('2', 'brawl', ['beam'], ['毛妹']),
  roadhog: profile('2', 'brawl', ['self-heal', 'close'], ['猪']),
  orisa: profile('2', 'brawl', ['projectile'], ['马']),
  ramattra: profile('2', 'brawl', ['close']),
  'junker-queen': profile('2', 'brawl', ['anti-heal', 'close'], ['女王']),
  mauga: profile('2', 'brawl', ['self-heal', 'close']),
  doomfist: profile('2', 'dive', ['mobile'], ['铁拳']),
  'wrecking-ball': profile('2', 'dive', ['mobile'], ['球']),
  pharah: profile('1', 'poke', ['air', 'projectile'], ['法鸡']),
  echo: profile('1', 'dive', ['air', 'projectile', 'beam']),
  genji: profile('1', 'dive', ['mobile', 'reflect', 'projectile']),
  tracer: profile('1', 'dive', ['mobile'], ['闪光']),
  reaper: profile('1', 'brawl', ['close', 'self-heal']),
  ashe: profile('1', 'poke', ['anti-air', 'hitscan']),
  cassidy: profile('1', 'poke', ['anti-air', 'hitscan'], ['麦克雷', '麦爹']),
  widowmaker: profile('1', 'poke', ['anti-air', 'hitscan', 'isolated'], ['寡妇']),
  'soldier-76': profile('1', 'poke', ['anti-air', 'hitscan'], ['76', '士兵76']),
  sojourn: profile('1', 'poke', ['anti-air', 'hitscan']),
  bastion: profile('1', 'poke', ['burst', 'blockable'], ['堡垒']),
  hanzo: profile('1', 'poke', ['projectile', 'isolated']),
  torbjorn: profile('1', 'brawl', ['turret', 'projectile'], ['托比昂']),
  mei: profile('1', 'brawl', ['beam', 'close'], ['小美']),
  symmetra: profile('1', 'brawl', ['beam', 'turret'], ['三妹']),
  junkrat: profile('1', 'poke', ['projectile'], ['老鼠']),
  sombra: profile('3', 'dive', ['mobile', 'heal']),
  venture: profile('1', 'brawl', ['mobile', 'close']),
  freja: profile('1', 'poke', ['projectile']),
  ana: profile('3', 'poke', ['anti-heal', 'isolated', 'heal']),
  kiriko: profile('3', 'dive', ['cleanse', 'heal'], ['狐狸']),
  lucio: profile('3', 'brawl', ['speed', 'peel', 'heal'], ['dj', '卢西奥']),
  brigitte: profile('3', 'brawl', ['peel', 'heal'], ['锤妹']),
  moira: profile('3', 'brawl', ['beam', 'heal']),
  zenyatta: profile('3', 'poke', ['isolated', 'heal'], ['和尚']),
  mercy: profile('3', 'poke', ['boost', 'heal']),
  baptiste: profile('3', 'poke', ['anti-air', 'hitscan', 'heal'], ['巴蒂']),
  illari: profile('3', 'poke', ['anti-air', 'hitscan', 'heal']),
  lifeweaver: profile('3', 'poke', ['heal']),
  juno: profile('3', 'dive', ['speed', 'heal']),
}

export const TACTIC_SOURCES = [
  { id: 'counterpickgg', title: 'CounterPickGG：社区克制评分与英雄条目', url: 'https://counterpickgg.com/' },
  { id: 'counterpickgg-faq', title: 'CounterPickGG：数据口径与更新说明', url: 'https://counterpickgg.com/faq' },
  { id: 'counterwatch', title: '交叉研究：Counterwatch 的对抗统计方法（本版未混合其评分）', url: 'https://www.counterwatch.gg/methodology' },
  { id: 'roles', title: '官方 5v5 职责队列：1 重装 / 2 输出 / 2 支援', url: 'https://overwatch.blizzard.com/en-us/news/24104605/director-s-take-opening-up-the-conversation-on-5v5-and%20-6v6/' },
]

import { describe, expect, it } from 'vitest'
import {
  applyHit,
  cmPer360,
  createBodyState,
  degreesPerMouseCount,
  edpi,
  movementProfile,
  sortScores,
  sourceFovToVertical,
} from './index.js'

describe('mouse calibration', () => {
  it('matches Source angle and distance formulas', () => {
    expect(edpi(800, 1)).toBe(800)
    expect(cmPer360(800, 1)).toBeCloseTo(51.9545, 3)
    expect(degreesPerMouseCount(1, 0, 1)).toBeCloseTo(0.022, 8)
    expect(degreesPerMouseCount(1, 1, 1)).toBeCloseTo(0.022 * (40 / 90), 8)
  })

  it('converts Source 4:3 horizontal FOV into Three vertical FOV', () => {
    expect(sourceFovToVertical(90)).toBeCloseTo(73.7398, 3)
    expect(sourceFovToVertical(40)).toBeCloseTo(30.5369, 3)
  })
})

describe('body damage', () => {
  it('kills on one head hit and two torso hits', () => {
    const head = applyHit(createBodyState(), 'head')
    expect(head).toMatchObject({ fatal: true, damage: 100 })
    expect(head.body.health).toBe(0)
    const first = applyHit(createBodyState(), 'torso')
    expect(first.fatal).toBe(false)
    expect(first.body.health).toBe(45)
    const second = applyHit(first.body, 'torso')
    expect(second.fatal).toBe(true)
    expect(second.body.health).toBe(0)
  })

  it('detaches each intact limb once and kills after three distinct limbs', () => {
    const first = applyHit(createBodyState(), 'leftArm')
    expect(first.detachedPart).toBe('leftArm')
    const second = applyHit(first.body, 'rightArm')
    const third = applyHit(second.body, 'leftLeg')
    expect(third.body.limbHits).toBe(3)
    expect(third.fatal).toBe(true)
    expect(third.body.health).toBe(0)
  })

  it('combines torso and limb damage against the same 100 HP pool', () => {
    const torso = applyHit(createBodyState(), 'torso')
    expect(torso).toMatchObject({ damage: 55, fatal: false })
    const limb = applyHit(torso.body, 'rightLeg')
    expect(limb).toMatchObject({ damage: 45, fatal: true })
    expect(limb.body.health).toBe(0)
  })

  it('combines injury movement restrictions', () => {
    let body = applyHit(createBodyState(), 'torso').body
    body = applyHit(body, 'leftArm').body
    expect(movementProfile(body)).toMatchObject({ speedScale: 0.675, accelerationScale: 0.85, canJump: false })
    body = applyHit(body, 'leftLeg').body
    expect(movementProfile(body).speedScale).toBeCloseTo(0.37125, 5)
    body = applyHit(body, 'rightLeg').body
    expect(movementProfile(body)).toMatchObject({ speedScale: 0.2, crawling: true, canJump: false })
  })
})

describe('score ordering', () => {
  it('uses duel score, escapes, escape time and stop time in that order', () => {
    const base = { playerId: 'a', name: 'A', duelWins: 2, runnerEscapes: 1, runnerEscapeTimeMs: 20_000, sniperStops: 1, sniperStopTimeMs: 40_000 }
    const sorted = sortScores([
      base,
      { ...base, playerId: 'b', name: 'B', runnerEscapeTimeMs: 18_000 },
      { ...base, playerId: 'c', name: 'C', duelWins: 3 },
    ])
    expect(sorted.map(score => score.playerId)).toEqual(['c', 'b', 'a'])
  })
})

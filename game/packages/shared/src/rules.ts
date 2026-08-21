import { CS2_AWP_2026_08 } from './constants.js'
import type { BodyPart, BodyState, LimbPart, ScoreEntry } from './types.js'

export function createBodyState(): BodyState {
  return {
    health: 100,
    headHits: 0,
    torsoHits: 0,
    limbHits: 0,
    limbs: {
      leftArm: 'intact',
      rightArm: 'intact',
      leftLeg: 'intact',
      rightLeg: 'intact',
    },
  }
}

export interface AppliedHit {
  body: BodyState
  fatal: boolean
  detachedPart: LimbPart | null
  damage: number
}

export function applyHit(current: BodyState, part: BodyPart): AppliedHit {
  const body: BodyState = {
    ...current,
    limbs: { ...current.limbs },
  }
  let detachedPart: LimbPart | null = null
  const damage = part === 'head' ? 100 : part === 'torso' ? 55 : 45

  if (part === 'head') body.headHits += 1
  else if (part === 'torso') body.torsoHits += 1
  else if (body.limbs[part] === 'intact') {
    body.limbs[part] = 'broken'
    body.limbHits += 1
    detachedPart = part
  }
  body.health = Math.max(0, body.health - damage)

  return {
    body,
    detachedPart,
    damage,
    fatal: body.health <= 0,
  }
}

export function movementProfile(body: BodyState) {
  const brokenArms = Number(body.limbs.leftArm === 'broken') + Number(body.limbs.rightArm === 'broken')
  const brokenLegs = Number(body.limbs.leftLeg === 'broken') + Number(body.limbs.rightLeg === 'broken')

  let speedScale = body.torsoHits > 0 ? 0.75 : 1
  speedScale *= 0.9 ** brokenArms
  if (brokenLegs === 1) speedScale *= 0.55
  if (brokenLegs === 2) speedScale = Math.min(speedScale, 0.2)

  return {
    speedScale,
    accelerationScale: 0.85 ** brokenArms,
    canJump: body.torsoHits === 0 && brokenLegs === 0 && brokenArms < 2,
    crawling: brokenLegs === 2,
  }
}

export function edpi(dpi: number, sensitivity: number) {
  return dpi * sensitivity
}

export function cmPer360(dpi: number, sensitivity: number, mYaw = CS2_AWP_2026_08.mYaw) {
  if (dpi <= 0 || sensitivity <= 0 || mYaw <= 0) return Number.POSITIVE_INFINITY
  return (360 / (dpi * sensitivity * mYaw)) * 2.54
}

export function degreesPerMouseCount(sensitivity: number, scopeLevel: 0 | 1 | 2, zoomRatio: number) {
  const fovScale = scopeLevel === 0 ? 1 : CS2_AWP_2026_08.zoomFovs[scopeLevel - 1]! / CS2_AWP_2026_08.baseFov
  return sensitivity * CS2_AWP_2026_08.mYaw * fovScale * (scopeLevel === 0 ? 1 : zoomRatio)
}

export function sourceFovToVertical(sourceFov: number) {
  return 2 * Math.atan(Math.tan((sourceFov * Math.PI) / 360) / (4 / 3)) * (180 / Math.PI)
}

export function sortScores(scores: ScoreEntry[]) {
  return [...scores].sort((a, b) =>
    b.duelWins - a.duelWins
      || b.runnerEscapes - a.runnerEscapes
      || a.runnerEscapeTimeMs - b.runnerEscapeTimeMs
      || a.sniperStopTimeMs - b.sniperStopTimeMs,
  )
}

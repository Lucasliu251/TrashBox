import { describe, expect, it } from 'vitest'
import { createBodyState, createSimState } from '@trashbox/sniper-shared'
import { applyWeaponSpread, rayMap, rayPlayer, viewDirection } from './collision.js'

describe('authoritative shot collision', () => {
  it('finds a head hit on a centered standing runner', () => {
    const target = createSimState('runner', { x: 0, y: 0, z: 0 }, createBodyState())
    const origin = { x: 0, y: 1.64, z: 10 }
    const hit = rayPlayer(origin, { x: 0, y: 0, z: -1 }, target, target.body)
    expect(hit?.part).toBe('head')
    expect(hit?.distance).toBeCloseTo(9.81, 2)
  })

  it('removes a detached limb and classifies its proximal stump as torso', () => {
    const target = createSimState('runner', { x: 0, y: 0, z: 0 }, createBodyState())
    target.yaw = 0
    target.body.limbs.leftArm = 'broken'
    const hit = rayPlayer({ x: -0.39, y: 1.27, z: 3 }, { x: 0, y: 0, z: -1 }, target, target.body)
    expect(hit?.part).toBe('torso')
  })

  it('detects static cover before a distant player and has seeded spread', () => {
    const origin = { x: 0.5, y: 1.64, z: -24 }
    expect(rayMap(origin, { x: 0, y: 0, z: 1 })).not.toBeNull()
    const state = createSimState('sniper', { x: 0, y: 8, z: 53.5 }, createBodyState())
    const direction = viewDirection(Math.PI, 0)
    expect(applyWeaponSpread(direction, state, 42)).toEqual(applyWeaponSpread(direction, state, 42))
  })
})

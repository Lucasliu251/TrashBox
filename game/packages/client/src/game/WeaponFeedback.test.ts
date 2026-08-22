import { describe, expect, it } from 'vitest'
import { reloadPose } from './WeaponFeedback'

describe('reload animation curve', () => {
  it('starts and finishes from the normal weapon pose', () => {
    expect(reloadPose(0)).toEqual({ weaponAmount: 0, magazineAmount: 0 })
    expect(reloadPose(1)).toEqual({ weaponAmount: 0, magazineAmount: 0 })
  })

  it('lowers the weapon and removes then reinserts the magazine', () => {
    expect(reloadPose(0.2).weaponAmount).toBe(1)
    expect(reloadPose(0.3).magazineAmount).toBeGreaterThan(0)
    expect(reloadPose(0.5).magazineAmount).toBe(1)
    expect(reloadPose(0.72).magazineAmount).toBeGreaterThan(0)
    expect(reloadPose(0.8).magazineAmount).toBe(0)
  })
})

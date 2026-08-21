import { describe, expect, it } from 'vitest'
import { MAP_OBSTACLES, PLAYER_DIMENSIONS, SIMULATION_DT, SIMULATION_HZ, WORLD, createBodyState, createSimState, simulateMovement, type InputCommand } from './index.js'

const input = (seq: number, overrides: Partial<InputCommand['buttons']> = {}): InputCommand => ({
  seq,
  clientTime: seq * SIMULATION_DT * 1000,
  yaw: Math.PI,
  pitch: 0,
  buttons: { forward: false, back: false, left: false, right: false, walk: false, crouch: false, jump: false, ...overrides },
})

describe('128 Hz movement simulation', () => {
  it('is deterministic for identical input streams', () => {
    const first = createSimState('runner', { x: 5, y: 0, z: WORLD.runnerSpawnZ }, createBodyState())
    const second = createSimState('runner', { x: 5, y: 0, z: WORLD.runnerSpawnZ }, createBodyState())
    for (let tick = 1; tick <= SIMULATION_HZ * 2; tick += 1) {
      simulateMovement(first, input(tick, { forward: true }), SIMULATION_DT)
      simulateMovement(second, input(tick, { forward: true }), SIMULATION_DT)
    }
    expect(first).toEqual(second)
    expect(first.position.z).toBeGreaterThan(WORLD.runnerSpawnZ + 7)
  })

  it('accelerates, counter-strafes and stops without exceeding runner speed', () => {
    const state = createSimState('runner', { x: 5, y: 0, z: WORLD.runnerSpawnZ }, createBodyState())
    for (let tick = 1; tick <= SIMULATION_HZ / 2; tick += 1) simulateMovement(state, input(tick, { right: true }), SIMULATION_DT)
    expect(Math.abs(state.velocity.x)).toBeLessThanOrEqual(5)
    const before = state.velocity.x
    for (let tick = SIMULATION_HZ / 2 + 1; tick <= SIMULATION_HZ / 2 + 20; tick += 1) simulateMovement(state, input(tick, { left: true }), SIMULATION_DT)
    expect(Math.abs(state.velocity.x)).toBeLessThan(Math.abs(before))
  })

  it('keeps the sniper fixed on the elevated firing point while preserving aim', () => {
    const state = createSimState('sniper', WORLD.sniperSpawn, createBodyState())
    for (let tick = 1; tick <= 300; tick += 1) simulateMovement(state, input(tick, { right: true }), SIMULATION_DT)
    expect(state.position).toEqual(WORLD.sniperSpawn)
    expect(state.velocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(state.yaw).toBe(Math.PI)
  })

  it('keeps compact cover inside the requested player-relative dimensions', () => {
    const covers = MAP_OBSTACLES.filter(obstacle => obstacle.kind !== 'platform')
    expect(WORLD).toMatchObject({ width: 12, length: 56 })
    expect(SIMULATION_HZ).toBe(128)
    for (const obstacle of covers) {
      expect(obstacle.size.x).toBeGreaterThanOrEqual(PLAYER_DIMENSIONS.visualWidth)
      expect(obstacle.size.x).toBeLessThanOrEqual(PLAYER_DIMENSIONS.visualWidth * 1.8)
      expect(obstacle.size.y).toBeGreaterThan(PLAYER_DIMENSIONS.crouchHeight)
      expect(obstacle.size.y).toBeLessThanOrEqual(PLAYER_DIMENSIONS.standHeight * 1.5)
    }
  })
})

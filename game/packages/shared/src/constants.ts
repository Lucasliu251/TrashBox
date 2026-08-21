import type { MapObstacle, Vec3, WeaponPreset } from './types.js'

export const SIMULATION_HZ = 128
export const SNAPSHOT_HZ = 64
export const SIMULATION_DT = 1 / SIMULATION_HZ
export const ROUND_DURATION_MS = 90_000
export const ROUND_RESULT_MS = 5_000
export const RECONNECT_GRACE_MS = 15_000
export const EMPTY_ROOM_TTL_MS = 10 * 60_000
export const MAX_PLAYERS = 5
export const HISTORY_WINDOW_MS = 250
export const MAX_REWIND_MS = 200

export const CS2_AWP_2026_08: WeaponPreset = {
  id: 'CS2_AWP_2026_08',
  label: 'CS2 AWP / 2026-08 calibration snapshot',
  mYaw: 0.022,
  baseFov: 90,
  zoomFovs: [40, 10],
  zoomTimesMs: [300, 200],
  cycleTimeMs: 1455,
  reloadTimeMs: 3700,
  magazineSize: 5,
  reserveAmmo: 25,
  unscopedSpeed: 4,
  scopedSpeed: 2,
  spread: 0.0002,
  inaccuracyStandUnscoped: 0.0808,
  inaccuracyStandScoped: 0.002,
  inaccuracyCrouchScoped: 0.0015,
  inaccuracyMove: 0.17648,
  inaccuracyJump: 0.12,
  inaccuracyLand: 0.08,
  movementInaccuracyThreshold: 0.34,
  landingRecoveryMs: 400,
  scopeRecoveryMs: 300,
  recoilPitchDegrees: 1.72,
}

export const WORLD = {
  width: 12,
  length: 56,
  wallHeight: 4,
  runnerSpawnZ: -25,
  exitZ: 26.5,
  sniperSpawn: { x: 0, y: 8.02, z: 22.5 } satisfies Vec3,
  sniperPlatform: { minX: -3, maxX: 3, minZ: 19.5, maxZ: 25.5, y: 8 },
} as const

export const PLAYER_DIMENSIONS = {
  visualWidth: 1,
  collisionRadius: 0.34,
  standHeight: 1.8,
  crouchHeight: 1.18,
} as const

const cover = (
  id: string,
  x: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  kind: MapObstacle['kind'],
): MapObstacle => ({ id, center: { x, y: height / 2, z }, size: { x: width, y: height, z: depth }, kind })

export const MAP_OBSTACLES: readonly MapObstacle[] = [
  cover('low-left-a', -3.8, -21, 1.6, 1.25, 1.2, 'low'),
  cover('crate-mid-a', -0.8, -19, 1.2, 1.5, 1.5, 'crate'),
  cover('wall-right-a', 3.7, -17, 1.8, 2.7, 1, 'wall'),
  cover('container-left-a', -3.8, -14.5, 1.8, 2.4, 3, 'container'),
  cover('low-mid-a', 0, -13, 1.8, 1.25, 1, 'low'),
  cover('crate-right-a', 3.8, -11, 1.4, 1.5, 1.6, 'crate'),
  cover('wall-mid-a', 0.5, -8.5, 1, 2.7, 3, 'wall'),
  cover('vehicle-left', -3.6, -6.5, 1.8, 1.6, 1.5, 'vehicle'),
  cover('low-right-b', 3.7, -4.5, 1.8, 1.25, 1, 'low'),
  cover('crate-left-b', -3.8, -2, 1.2, 1.5, 1.5, 'crate'),
  cover('container-right-b', 3.8, 0, 1.8, 2.4, 3, 'container'),
  cover('wall-left-b', -2.8, 2.5, 1.8, 2.7, 1, 'wall'),
  cover('low-mid-b', 0, 5, 1.5, 1.25, 1, 'low'),
  cover('crate-right-c', 3.8, 7.5, 1.3, 1.5, 1.5, 'crate'),
  cover('wall-mid-c', 1, 10, 1, 2.7, 3, 'wall'),
  cover('vehicle-left-c', -3.7, 12, 1.8, 1.6, 1.5, 'vehicle'),
  cover('low-right-c', 3.8, 14.5, 1.8, 1.25, 1, 'low'),
  cover('crate-left-c', -3.8, 17, 1.2, 1.5, 1.5, 'crate'),
  cover('finish-wall-left', -2.8, 19, 1.8, 2.7, 1, 'wall'),
  cover('finish-wall-right', 2.8, 19, 1.8, 2.7, 1, 'wall'),
  cover('sniper-platform', 0, 22.5, 6, 8, 6, 'platform'),
] as const

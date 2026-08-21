import { MAP_OBSTACLES, PLAYER_DIMENSIONS, WORLD } from './constants.js'
import { movementProfile } from './rules.js'
import type { InputCommand, MapObstacle, SimPlayerState, Vec3 } from './types.js'

const PLAYER_RADIUS = PLAYER_DIMENSIONS.collisionRadius
const STAND_HEIGHT = PLAYER_DIMENSIONS.standHeight
const CROUCH_HEIGHT = PLAYER_DIMENSIONS.crouchHeight
const GRAVITY = 16
const JUMP_VELOCITY = 6.04

function approach(current: number, target: number, amount: number) {
  if (current < target) return Math.min(current + amount, target)
  return Math.max(current - amount, target)
}

function expandedBounds(obstacle: MapObstacle, radius: number) {
  return {
    minX: obstacle.center.x - obstacle.size.x / 2 - radius,
    maxX: obstacle.center.x + obstacle.size.x / 2 + radius,
    minY: obstacle.center.y - obstacle.size.y / 2,
    maxY: obstacle.center.y + obstacle.size.y / 2,
    minZ: obstacle.center.z - obstacle.size.z / 2 - radius,
    maxZ: obstacle.center.z + obstacle.size.z / 2 + radius,
  }
}

function verticallyIntersects(state: SimPlayerState, obstacle: MapObstacle) {
  const bounds = expandedBounds(obstacle, PLAYER_RADIUS)
  const playerHeight = state.crouching ? CROUCH_HEIGHT : STAND_HEIGHT
  return state.position.y + 0.05 < bounds.maxY && state.position.y + playerHeight > bounds.minY
}

function collideAxis(state: SimPlayerState, next: Vec3, axis: 'x' | 'z') {
  const previous = next[axis]
  for (const obstacle of MAP_OBSTACLES) {
    if (!verticallyIntersects(state, obstacle)) continue
    const bounds = expandedBounds(obstacle, PLAYER_RADIUS)
    if (next.x > bounds.minX && next.x < bounds.maxX && next.z > bounds.minZ && next.z < bounds.maxZ) {
      next[axis] = state.position[axis]
      state.velocity[axis] = 0
      break
    }
  }
  return previous !== next[axis]
}

function floorHeightAt(position: Vec3) {
  let height = 0
  for (const obstacle of MAP_OBSTACLES) {
    const bounds = expandedBounds(obstacle, -0.05)
    if (position.x > bounds.minX && position.x < bounds.maxX && position.z > bounds.minZ && position.z < bounds.maxZ) {
      height = Math.max(height, bounds.maxY)
    }
  }
  return height
}

export function simulateMovement(state: SimPlayerState, input: InputCommand, dt: number) {
  state.yaw = input.yaw
  state.pitch = input.pitch
  if (state.role === 'sniper') {
    state.position = { ...WORLD.sniperSpawn }
    state.velocity = { x: 0, y: 0, z: 0 }
    state.grounded = true
    state.crouching = false
    return state
  }
  state.crouching = input.buttons.crouch || movementProfile(state.body).crawling

  const profile = movementProfile(state.body)
  const forwardAxis = Number(input.buttons.forward) - Number(input.buttons.back)
  const sideAxis = Number(input.buttons.right) - Number(input.buttons.left)
  const length = Math.hypot(forwardAxis, sideAxis) || 1
  const localForward = forwardAxis / length
  const localSide = sideAxis / length
  const sin = Math.sin(state.yaw)
  const cos = Math.cos(state.yaw)
  const desiredX = localSide * cos - localForward * sin
  const desiredZ = -localSide * sin - localForward * cos

  const weaponSpeed = 5
  const crouchScale = state.crouching ? 0.34 : 1
  const walkScale = input.buttons.walk ? 0.52 : 1
  const maxSpeed = weaponSpeed * profile.speedScale * crouchScale * walkScale
  const moving = forwardAxis !== 0 || sideAxis !== 0
  const acceleration = (moving ? 22 : 32) * profile.accelerationScale

  state.velocity.x = approach(state.velocity.x, desiredX * maxSpeed, acceleration * dt)
  state.velocity.z = approach(state.velocity.z, desiredZ * maxSpeed, acceleration * dt)

  if (input.buttons.jump && state.grounded && profile.canJump && !state.crouching) {
    state.velocity.y = JUMP_VELOCITY
    state.grounded = false
  }
  if (!state.grounded) state.velocity.y -= GRAVITY * dt

  const next = {
    x: state.position.x + state.velocity.x * dt,
    y: state.position.y + state.velocity.y * dt,
    z: state.position.z + state.velocity.z * dt,
  }

  collideAxis(state, next, 'x')
  collideAxis(state, next, 'z')

  next.x = Math.max(-WORLD.width / 2 + PLAYER_RADIUS, Math.min(WORLD.width / 2 - PLAYER_RADIUS, next.x))
  next.z = Math.max(-WORLD.length / 2 + PLAYER_RADIUS, Math.min(WORLD.length / 2 - PLAYER_RADIUS, next.z))

  const floor = floorHeightAt(next)
  if (next.y <= floor && state.velocity.y <= 0) {
    next.y = floor
    state.velocity.y = 0
    state.grounded = true
  }

  state.position = next
  return state
}

export function createSimState(role: SimPlayerState['role'], position: Vec3, body: SimPlayerState['body']): SimPlayerState {
  return {
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: role === 'sniper' ? 0 : Math.PI,
    pitch: 0,
    grounded: true,
    crouching: false,
    role,
    body,
    scopedLevel: 0,
  }
}

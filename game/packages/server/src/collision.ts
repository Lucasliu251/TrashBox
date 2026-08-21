import {
  CS2_AWP_2026_08,
  MAP_OBSTACLES,
  type BodyPart,
  type BodyState,
  type LimbPart,
  type MapObstacle,
  type SimPlayerState,
  type Vec3,
} from '@trashbox/sniper-shared'

interface SphereHitbox {
  center: Vec3
  radius: number
  part: BodyPart
}

export interface RayHit {
  distance: number
  point: Vec3
  part: BodyPart
}

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale = (v: Vec3, amount: number): Vec3 => ({ x: v.x * amount, y: v.y * amount, z: v.z * amount })
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const normalize = (v: Vec3) => {
  const length = Math.hypot(v.x, v.y, v.z) || 1
  return scale(v, 1 / length)
}

function rotateOffset(x: number, z: number, yaw: number) {
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  return { x: x * cos - z * sin, z: x * sin + z * cos }
}

function sphere(origin: Vec3, state: SimPlayerState, x: number, y: number, z: number, radius: number, part: BodyPart): SphereHitbox {
  const rotated = rotateOffset(x, z, state.yaw)
  return {
    center: { x: origin.x + rotated.x, y: origin.y + y, z: origin.z + rotated.z },
    radius,
    part,
  }
}

function hitboxes(state: SimPlayerState, body: BodyState): SphereHitbox[] {
  const heightScale = state.crouching ? 0.69 : 1
  const p = state.position
  const boxes: SphereHitbox[] = [
    sphere(p, state, 0, 1.64 * heightScale, 0, 0.19, 'head'),
    sphere(p, state, 0, 1.38 * heightScale, 0, 0.3, 'torso'),
    sphere(p, state, 0, 1.08 * heightScale, 0, 0.33, 'torso'),
    sphere(p, state, 0, 0.82 * heightScale, 0, 0.28, 'torso'),
  ]

  const addLimb = (part: LimbPart, x: number, heights: number[], radius: number) => {
    if (body.limbs[part] === 'broken') return
    for (const y of heights) boxes.push(sphere(p, state, x, y * heightScale, 0, radius, part))
  }
  addLimb('leftArm', -0.39, [1.27, 1.02, 0.78], 0.125)
  addLimb('rightArm', 0.39, [1.27, 1.02, 0.78], 0.125)
  addLimb('leftLeg', -0.18, [0.7, 0.43, 0.18], 0.145)
  addLimb('rightLeg', 0.18, [0.7, 0.43, 0.18], 0.145)
  if (body.limbs.leftArm === 'broken') boxes.push(sphere(p, state, -0.32, 1.3 * heightScale, 0, 0.15, 'torso'))
  if (body.limbs.rightArm === 'broken') boxes.push(sphere(p, state, 0.32, 1.3 * heightScale, 0, 0.15, 'torso'))
  if (body.limbs.leftLeg === 'broken') boxes.push(sphere(p, state, -0.16, 0.76 * heightScale, 0, 0.16, 'torso'))
  if (body.limbs.rightLeg === 'broken') boxes.push(sphere(p, state, 0.16, 0.76 * heightScale, 0, 0.16, 'torso'))
  return boxes
}

function raySphere(origin: Vec3, direction: Vec3, hitbox: SphereHitbox) {
  const oc = {
    x: origin.x - hitbox.center.x,
    y: origin.y - hitbox.center.y,
    z: origin.z - hitbox.center.z,
  }
  const b = dot(oc, direction)
  const c = dot(oc, oc) - hitbox.radius * hitbox.radius
  const discriminant = b * b - c
  if (discriminant < 0) return null
  const near = -b - Math.sqrt(discriminant)
  return near >= 0 ? near : null
}

export function rayPlayer(origin: Vec3, direction: Vec3, state: SimPlayerState, body: BodyState): RayHit | null {
  let best: RayHit | null = null
  for (const box of hitboxes(state, body)) {
    const distance = raySphere(origin, direction, box)
    if (distance == null || (best && best.distance <= distance)) continue
    best = { distance, point: add(origin, scale(direction, distance)), part: box.part }
  }
  return best
}

function obstacleBounds(obstacle: MapObstacle) {
  return {
    min: {
      x: obstacle.center.x - obstacle.size.x / 2,
      y: obstacle.center.y - obstacle.size.y / 2,
      z: obstacle.center.z - obstacle.size.z / 2,
    },
    max: {
      x: obstacle.center.x + obstacle.size.x / 2,
      y: obstacle.center.y + obstacle.size.y / 2,
      z: obstacle.center.z + obstacle.size.z / 2,
    },
  }
}

function rayBox(origin: Vec3, direction: Vec3, obstacle: MapObstacle) {
  const bounds = obstacleBounds(obstacle)
  let minDistance = 0
  let maxDistance = Number.POSITIVE_INFINITY
  for (const axis of ['x', 'y', 'z'] as const) {
    if (Math.abs(direction[axis]) < 1e-8) {
      if (origin[axis] < bounds.min[axis] || origin[axis] > bounds.max[axis]) return null
      continue
    }
    const inverse = 1 / direction[axis]
    let near = (bounds.min[axis] - origin[axis]) * inverse
    let far = (bounds.max[axis] - origin[axis]) * inverse
    if (near > far) [near, far] = [far, near]
    minDistance = Math.max(minDistance, near)
    maxDistance = Math.min(maxDistance, far)
    if (minDistance > maxDistance) return null
  }
  return minDistance
}

export function rayMap(origin: Vec3, direction: Vec3) {
  let nearest: number | null = null
  for (const obstacle of MAP_OBSTACLES) {
    const distance = rayBox(origin, direction, obstacle)
    if (distance != null && distance >= 0 && (nearest == null || distance < nearest)) nearest = distance
  }
  return nearest
}

function seededRandom(seed: number) {
  let value = seed | 0
  return () => {
    value |= 0
    value = (value + 0x6D2B79F5) | 0
    let output = Math.imul(value ^ (value >>> 15), 1 | value)
    output = (output + Math.imul(output ^ (output >>> 7), 61 | output)) ^ output
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296
  }
}

export function viewDirection(yaw: number, pitch: number) {
  const cosPitch = Math.cos(pitch)
  return normalize({
    x: -Math.sin(yaw) * cosPitch,
    y: -Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  })
}

export function applyWeaponSpread(direction: Vec3, state: SimPlayerState, seed: number, transientInaccuracy = 0) {
  const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z)
  const maxSpeed = state.scopedLevel ? CS2_AWP_2026_08.scopedSpeed : CS2_AWP_2026_08.unscopedSpeed
  const base = state.scopedLevel
    ? (state.crouching ? CS2_AWP_2026_08.inaccuracyCrouchScoped : CS2_AWP_2026_08.inaccuracyStandScoped)
    : CS2_AWP_2026_08.inaccuracyStandUnscoped
  const movementRatio = Math.max(0, horizontalSpeed / maxSpeed - CS2_AWP_2026_08.movementInaccuracyThreshold)
  const inaccuracy = base
    + CS2_AWP_2026_08.spread
    + movementRatio * CS2_AWP_2026_08.inaccuracyMove
    + (state.grounded ? 0 : CS2_AWP_2026_08.inaccuracyJump)
    + Math.max(0, transientInaccuracy)
  const random = seededRandom(seed)
  const angle = random() * Math.PI * 2
  const radius = Math.sqrt(random()) * inaccuracy
  const worldUp = Math.abs(direction.y) > 0.98 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const right = normalize({
    x: direction.y * worldUp.z - direction.z * worldUp.y,
    y: direction.z * worldUp.x - direction.x * worldUp.z,
    z: direction.x * worldUp.y - direction.y * worldUp.x,
  })
  const up = normalize({
    x: right.y * direction.z - right.z * direction.y,
    y: right.z * direction.x - right.x * direction.z,
    z: right.x * direction.y - right.y * direction.x,
  })
  return normalize(add(direction, add(scale(right, Math.cos(angle) * radius), scale(up, Math.sin(angle) * radius))))
}

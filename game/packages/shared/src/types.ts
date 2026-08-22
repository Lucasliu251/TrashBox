export interface Vec3 {
  x: number
  y: number
  z: number
}

export type PlayerRole = 'sniper' | 'runner'
export type LifeState = 'alive' | 'dead' | 'escaped' | 'timed_out' | 'incapacitated'
export type BodyPart = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg'
export type LimbPart = Exclude<BodyPart, 'head' | 'torso'>
export type RoomPhase = 'lobby' | 'countdown' | 'active' | 'round_result' | 'match_result'

export interface BodyState {
  health: number
  headHits: number
  torsoHits: number
  limbHits: number
  limbs: Record<LimbPart, 'intact' | 'broken'>
}

export interface InputButtons {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  walk: boolean
  crouch: boolean
  jump: boolean
}

export interface InputCommand {
  seq: number
  clientTime: number
  yaw: number
  pitch: number
  buttons: InputButtons
}

export interface WeaponPreset {
  id: string
  label: string
  mYaw: number
  baseFov: number
  zoomFovs: readonly [number, number]
  zoomTimesMs: readonly [number, number]
  cycleTimeMs: number
  reloadTimeMs: number
  magazineSize: number
  reserveAmmo: number
  unscopedSpeed: number
  scopedSpeed: number
  spread: number
  inaccuracyStandUnscoped: number
  inaccuracyStandScoped: number
  inaccuracyCrouchScoped: number
  inaccuracyMove: number
  inaccuracyJump: number
  inaccuracyLand: number
  movementInaccuracyThreshold: number
  landingRecoveryMs: number
  scopeRecoveryMs: number
  recoilPitchDegrees: number
}

export interface SimPlayerState {
  position: Vec3
  velocity: Vec3
  yaw: number
  pitch: number
  grounded: boolean
  crouching: boolean
  role: PlayerRole
  body: BodyState
  scopedLevel: 0 | 1 | 2
}

export interface PlayerSnapshot extends SimPlayerState {
  id: string
  name: string
  life: LifeState
  connected: boolean
  ready: boolean
  ammo: number
  reserveAmmo: number
  reloadingUntil: number
  nextShotAt: number
  lastProcessedInput: number
}

export interface RoundState {
  index: number
  sniperId: string
  startedAt: number
  endsAt: number
  paused: boolean
  completedRunnerIds: string[]
}

export interface ScoreEntry {
  playerId: string
  name: string
  duelWins: number
  runnerEscapes: number
  runnerEscapeTimeMs: number
  sniperStops: number
  sniperStopTimeMs: number
}

export interface RoomSnapshot {
  code: string
  phase: RoomPhase
  hostId: string
  players: PlayerSnapshot[]
  round: RoundState | null
  scores: ScoreEntry[]
  transitionAt: number | null
}

export interface ShotEvent {
  shotId: string
  inputSeq: number
  clientTime: number
  rttMs: number
}

export interface ReloadEvent {
  playerId: string
  startedAt: number
  endsAt: number
}

export interface HitResult {
  shotId: string
  shooterId: string
  targetId: string | null
  bodyPart: BodyPart | null
  point: Vec3 | null
  detachedPart: LimbPart | null
  fatal: boolean
  blocked: boolean
  damage: number
  remainingHealth: number | null
}

export interface MapObstacle {
  id: string
  center: Vec3
  size: Vec3
  kind: 'low' | 'crate' | 'wall' | 'container' | 'vehicle' | 'platform'
}

export type ClientMessage =
  | { type: 'room.create'; payload: { name: string } }
  | { type: 'room.join'; payload: { code: string; name: string } }
  | { type: 'room.ready'; payload: { ready: boolean } }
  | { type: 'room.start'; payload: Record<string, never> }
  | { type: 'room.leave'; payload: Record<string, never> }
  | { type: 'session.resume'; payload: { playerId: string; reconnectToken: string } }
  | { type: 'input.batch'; payload: { commands: InputCommand[] } }
  | { type: 'weapon.scope'; payload: { level: 0 | 1 | 2 } }
  | { type: 'weapon.reload'; payload: Record<string, never> }
  | { type: 'shot.fire'; payload: ShotEvent }
  | { type: 'ping'; payload: { clientTime: number } }

export type ServerMessage =
  | { type: 'session.welcome'; payload: { playerId: string; reconnectToken: string; roomCode: string } }
  | { type: 'session.left'; payload: { roomCode: string } }
  | { type: 'room.closed'; payload: { roomCode: string; message: string } }
  | { type: 'room.state'; payload: RoomSnapshot }
  | { type: 'state.snapshot'; payload: { serverTime: number; room: RoomSnapshot } }
  | { type: 'weapon.reload.started'; payload: ReloadEvent }
  | { type: 'shot.result'; payload: HitResult }
  | { type: 'round.result'; payload: { room: RoomSnapshot } }
  | { type: 'match.result'; payload: { scores: ScoreEntry[] } }
  | { type: 'pong'; payload: { clientTime: number; serverTime: number } }
  | { type: 'error'; payload: { code: string; message: string } }

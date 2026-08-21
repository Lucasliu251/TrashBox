import { randomBytes, randomUUID } from 'node:crypto'
import type WebSocket from 'ws'
import {
  applyHit,
  createBodyState,
  createSimState,
  CS2_AWP_2026_08,
  HISTORY_WINDOW_MS,
  MAP_OBSTACLES,
  MAX_PLAYERS,
  MAX_REWIND_MS,
  RECONNECT_GRACE_MS,
  ROUND_DURATION_MS,
  ROUND_RESULT_MS,
  simulateMovement,
  sortScores,
  WORLD,
  type ClientMessage,
  type HitResult,
  type InputCommand,
  type LifeState,
  type PlayerSnapshot,
  type RoomSnapshot,
  type ScoreEntry,
  type ServerMessage,
  type ShotEvent,
  type SimPlayerState,
} from '@trashbox/sniper-shared'
import { applyWeaponSpread, rayMap, rayPlayer, viewDirection } from './collision.js'

interface HistoryFrame {
  time: number
  state: SimPlayerState
  life: LifeState
  landingPenaltyUntil: number
  scopeReadyAt: number
}

interface Player {
  id: string
  reconnectToken: string
  name: string
  socket: WebSocket | null
  connected: boolean
  disconnectedAt: number | null
  ready: boolean
  life: LifeState
  state: SimPlayerState
  ammo: number
  reserveAmmo: number
  reloadingUntil: number
  nextShotAt: number
  shotCounter: number
  landingPenaltyUntil: number
  scopeReadyAt: number
  lastInput: InputCommand
  lastProcessedInput: number
  history: HistoryFrame[]
  score: ScoreEntry
}

const IDLE_INPUT: InputCommand = {
  seq: 0,
  clientTime: 0,
  yaw: 0,
  pitch: 0,
  buttons: {
    forward: false,
    back: false,
    left: false,
    right: false,
    walk: false,
    crouch: false,
    jump: false,
  },
}

const cloneState = (state: SimPlayerState): SimPlayerState => ({
  ...state,
  position: { ...state.position },
  velocity: { ...state.velocity },
  body: { ...state.body, limbs: { ...state.body.limbs } },
})

function safeName(name: string) {
  const value = String(name ?? '').replace(/[<>\u0000-\u001F]/g, '').trim().slice(0, 16)
  return value || 'Operator'
}

function spawnX(index: number, total: number) {
  if (total <= 1) return 0
  const halfSpan = Math.min(7.5, WORLD.width / 2 - 2)
  return -halfSpan + (halfSpan * 2 * index) / (total - 1)
}

function snapshotPlayer(player: Player): PlayerSnapshot {
  return {
    id: player.id,
    name: player.name,
    life: player.life,
    connected: player.connected,
    ready: player.ready,
    ammo: player.ammo,
    reserveAmmo: player.reserveAmmo,
    reloadingUntil: player.reloadingUntil,
    nextShotAt: player.nextShotAt,
    lastProcessedInput: player.lastProcessedInput,
    ...cloneState(player.state),
  }
}

export class Room {
  readonly code: string
  readonly players = new Map<string, Player>()
  hostId = ''
  phase: RoomSnapshot['phase'] = 'lobby'
  round: RoomSnapshot['round'] = null
  transitionAt: number | null = null
  lastOccupiedAt = Date.now()
  private rotation: string[] = []
  private pausedAt: number | null = null

  constructor(code: string) {
    this.code = code
  }

  get size() {
    return this.players.size
  }

  addPlayer(name: string, socket: WebSocket) {
    if (this.players.size >= MAX_PLAYERS) throw new Error('ROOM_FULL')
    if (this.phase !== 'lobby' && this.phase !== 'match_result') throw new Error('MATCH_IN_PROGRESS')
    const id = randomUUID()
    const player: Player = {
      id,
      reconnectToken: randomBytes(24).toString('base64url'),
      name: safeName(name),
      socket,
      connected: true,
      disconnectedAt: null,
      ready: false,
      life: 'alive',
      state: createSimState('runner', { x: 0, y: 0, z: WORLD.runnerSpawnZ }, createBodyState()),
      ammo: CS2_AWP_2026_08.magazineSize,
      reserveAmmo: CS2_AWP_2026_08.reserveAmmo,
      reloadingUntil: 0,
      nextShotAt: 0,
      shotCounter: 0,
      landingPenaltyUntil: 0,
      scopeReadyAt: 0,
      lastInput: structuredClone(IDLE_INPUT),
      lastProcessedInput: 0,
      history: [],
      score: {
        playerId: id,
        name: safeName(name),
        duelWins: 0,
        runnerEscapes: 0,
        runnerEscapeTimeMs: 0,
        sniperStops: 0,
        sniperStopTimeMs: 0,
      },
    }
    this.players.set(id, player)
    if (!this.hostId) this.hostId = id
    this.lastOccupiedAt = Date.now()
    this.send(player, { type: 'session.welcome', payload: { playerId: id, reconnectToken: player.reconnectToken, roomCode: this.code } })
    this.broadcastRoom()
    return player
  }

  resume(playerId: string, token: string, socket: WebSocket) {
    const player = this.players.get(playerId)
    if (!player || player.reconnectToken !== token) throw new Error('INVALID_SESSION')
    player.socket?.close(4001, 'Session resumed elsewhere')
    player.socket = socket
    player.connected = true
    player.disconnectedAt = null
    player.reconnectToken = randomBytes(24).toString('base64url')
    this.send(player, { type: 'session.welcome', payload: { playerId, reconnectToken: player.reconnectToken, roomCode: this.code } })
    if (this.round?.sniperId === playerId && this.pausedAt != null) this.resumeRound(Date.now())
    this.broadcastRoom()
    return player
  }

  disconnect(playerId: string, now: number) {
    const player = this.players.get(playerId)
    if (!player) return
    player.socket = null
    player.connected = false
    player.disconnectedAt = now
    if (this.phase === 'active' && this.round?.sniperId === playerId && this.pausedAt == null) {
      this.pausedAt = now
      this.round.paused = true
    }
    this.broadcastRoom()
  }

  leave(playerId: string, now: number) {
    if (this.phase !== 'lobby' && this.phase !== 'match_result') throw new Error('MATCH_IN_PROGRESS')
    const player = this.players.get(playerId)
    if (!player) throw new Error('INVALID_SESSION')
    if (playerId === this.hostId) {
      this.broadcast({ type: 'room.closed', payload: { roomCode: this.code, message: '房主已解散训练房间。' } })
      this.players.clear()
      this.hostId = ''
      this.lastOccupiedAt = now
      return { dissolved: true }
    }
    this.send(player, { type: 'session.left', payload: { roomCode: this.code } })
    this.players.delete(playerId)
    this.lastOccupiedAt = now
    this.broadcastRoom()
    return { dissolved: false }
  }

  handle(playerId: string, message: ClientMessage, now: number) {
    const player = this.players.get(playerId)
    if (!player) return
    switch (message.type) {
      case 'room.ready':
        if (this.phase === 'lobby' || this.phase === 'match_result') {
          player.ready = Boolean(message.payload.ready)
          this.broadcastRoom()
        }
        break
      case 'room.start':
        this.startMatch(playerId, now)
        break
      case 'input.batch':
        this.receiveInputs(player, message.payload.commands)
        break
      case 'weapon.scope':
        if (this.phase === 'active' && player.state.role === 'sniper' && player.life === 'alive' && [0, 1, 2].includes(message.payload.level)) {
          const previous = player.state.scopedLevel
          player.state.scopedLevel = message.payload.level
          if (message.payload.level === 0) player.scopeReadyAt = 0
          else {
            const transitionMs = message.payload.level === 2 && previous === 1
              ? CS2_AWP_2026_08.zoomTimesMs[1]
              : CS2_AWP_2026_08.zoomTimesMs[message.payload.level - 1]!
            player.scopeReadyAt = now + transitionMs
          }
        }
        break
      case 'weapon.reload':
        this.reload(player, now)
        break
      case 'shot.fire':
        this.fire(player, message.payload, now)
        break
      case 'ping':
        this.send(player, { type: 'pong', payload: { clientTime: message.payload.clientTime, serverTime: now } })
        break
      default:
        break
    }
  }

  tick(now: number, dt: number) {
    this.cleanupDisconnected(now)
    if (this.phase === 'active' && this.round) {
      if (!this.round.paused) {
        for (const player of this.players.values()) {
          if (!player.connected || player.life !== 'alive') continue
          if (player.reloadingUntil > 0 && now >= player.reloadingUntil) this.finishReload(player)
          const wasGrounded = player.state.grounded
          simulateMovement(player.state, player.lastInput, dt)
          if (!wasGrounded && player.state.grounded) player.landingPenaltyUntil = now + CS2_AWP_2026_08.landingRecoveryMs
          player.lastProcessedInput = player.lastInput.seq
          if (player.state.role === 'runner' && player.state.position.z >= WORLD.exitZ) this.resolveRunner(player, 'escaped', now)
          player.history.push({
            time: now,
            state: cloneState(player.state),
            life: player.life,
            landingPenaltyUntil: player.landingPenaltyUntil,
            scopeReadyAt: player.scopeReadyAt,
          })
          while (player.history[0] && player.history[0].time < now - HISTORY_WINDOW_MS) player.history.shift()
        }
        if (now >= this.round.endsAt) {
          for (const player of this.players.values()) {
            if (player.state.role === 'runner' && player.life === 'alive') this.resolveRunner(player, 'timed_out', now)
          }
        }
        this.maybeFinishRound(now)
      }
    } else if (this.phase === 'round_result' && this.transitionAt != null && now >= this.transitionAt) {
      this.startNextRound(now)
    }
  }

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players: [...this.players.values()].map(snapshotPlayer),
      round: this.round ? { ...this.round, completedRunnerIds: [...this.round.completedRunnerIds] } : null,
      scores: sortScores([...this.players.values()].map(player => ({ ...player.score }))),
      transitionAt: this.transitionAt,
    }
  }

  broadcastSnapshot(serverTime: number) {
    this.broadcast({ type: 'state.snapshot', payload: { serverTime, room: this.snapshot() } })
  }

  private startMatch(playerId: string, now: number) {
    if (playerId !== this.hostId) return this.sendError(this.players.get(playerId), 'NOT_HOST', '只有房主可以开始训练。')
    if (this.players.size < 2) return this.sendError(this.players.get(playerId), 'NEED_PLAYERS', '至少需要两名玩家。')
    if ([...this.players.values()].some(player => !player.ready || !player.connected)) {
      return this.sendError(this.players.get(playerId), 'NOT_READY', '所有玩家都需在线并准备。')
    }
    this.rotation = [...this.players.keys()]
    for (const player of this.players.values()) {
      player.score = { playerId: player.id, name: player.name, duelWins: 0, runnerEscapes: 0, runnerEscapeTimeMs: 0, sniperStops: 0, sniperStopTimeMs: 0 }
    }
    this.round = { index: -1, sniperId: '', startedAt: now, endsAt: now, paused: false, completedRunnerIds: [] }
    this.startNextRound(now)
  }

  private startNextRound(now: number) {
    const nextIndex = (this.round?.index ?? -1) + 1
    if (nextIndex >= this.rotation.length) {
      this.phase = 'match_result'
      this.transitionAt = null
      this.round = null
      for (const player of this.players.values()) player.ready = false
      this.broadcast({ type: 'match.result', payload: { scores: this.snapshot().scores } })
      this.broadcastRoom()
      return
    }
    const sniperId = this.rotation[nextIndex]
    if (!sniperId) return
    const runnerPlayers = [...this.players.values()].filter(player => player.id !== sniperId)
    let runnerIndex = 0
    for (const player of this.players.values()) {
      const isSniper = player.id === sniperId
      const position = isSniper
        ? WORLD.sniperSpawn
        : { x: spawnX(runnerIndex++, runnerPlayers.length), y: 0, z: WORLD.runnerSpawnZ }
      player.state = createSimState(isSniper ? 'sniper' : 'runner', position, createBodyState())
      player.life = 'alive'
      player.ammo = CS2_AWP_2026_08.magazineSize
      player.reserveAmmo = CS2_AWP_2026_08.reserveAmmo
      player.reloadingUntil = 0
      player.nextShotAt = 0
      player.shotCounter = 0
      player.landingPenaltyUntil = 0
      player.scopeReadyAt = 0
      player.lastInput = { ...structuredClone(IDLE_INPUT), yaw: isSniper ? 0 : Math.PI }
      player.lastProcessedInput = 0
      player.history = []
    }
    this.phase = 'active'
    this.transitionAt = null
    this.pausedAt = null
    this.round = {
      index: nextIndex,
      sniperId,
      startedAt: now,
      endsAt: now + ROUND_DURATION_MS,
      paused: false,
      completedRunnerIds: [],
    }
    this.broadcastRoom()
  }

  private receiveInputs(player: Player, commands: InputCommand[]) {
    if (this.phase !== 'active' || player.life !== 'alive' || !Array.isArray(commands)) return
    for (const received of commands.slice(-8)) {
      if (!received || typeof received !== 'object' || !received.buttons || typeof received.buttons !== 'object') continue
      if (!Number.isFinite(received.seq) || received.seq <= player.lastInput.seq || received.seq > player.lastInput.seq + 256) continue
      if (!Number.isFinite(received.yaw) || !Number.isFinite(received.pitch)) continue
      const command: InputCommand = {
        seq: Math.floor(received.seq),
        clientTime: Number.isFinite(received.clientTime) ? received.clientTime : 0,
        yaw: received.yaw,
        pitch: Math.max(-Math.PI * 0.494, Math.min(Math.PI * 0.494, received.pitch)),
        buttons: {
          forward: received.buttons.forward === true,
          back: received.buttons.back === true,
          left: received.buttons.left === true,
          right: received.buttons.right === true,
          walk: received.buttons.walk === true,
          crouch: received.buttons.crouch === true,
          jump: received.buttons.jump === true,
        },
      }
      player.lastInput = command
    }
  }

  private reload(player: Player, now: number) {
    if (this.phase !== 'active' || player.state.role !== 'sniper' || player.life !== 'alive') return
    if (player.reloadingUntil > now || player.ammo >= CS2_AWP_2026_08.magazineSize || player.reserveAmmo <= 0) return
    player.reloadingUntil = now + CS2_AWP_2026_08.reloadTimeMs
    player.state.scopedLevel = 0
    player.scopeReadyAt = 0
  }

  private finishReload(player: Player) {
    const needed = CS2_AWP_2026_08.magazineSize - player.ammo
    const loaded = Math.min(needed, player.reserveAmmo)
    player.ammo += loaded
    player.reserveAmmo -= loaded
    player.reloadingUntil = 0
  }

  private fire(shooter: Player, event: ShotEvent, now: number) {
    const round = this.round
    if (this.phase !== 'active' || !round || round.paused || shooter.state.role !== 'sniper' || shooter.life !== 'alive') return
    if (!event || !Number.isFinite(event.inputSeq) || typeof event.shotId !== 'string' || event.shotId.length > 80) return
    if (shooter.reloadingUntil > now || shooter.nextShotAt > now || shooter.ammo <= 0) return
    shooter.ammo -= 1
    shooter.shotCounter += 1
    shooter.nextShotAt = now + CS2_AWP_2026_08.cycleTimeMs
    shooter.state.scopedLevel = 0

    const rewind = Math.max(0, Math.min(MAX_REWIND_MS, Number(event.rttMs) / 2 || 0))
    const targetTime = now - rewind
    const shooterFrame = this.historyAt(shooter, targetTime)
    const shotState = shooterFrame?.state ?? shooter.state
    const scopeReadyAt = shooterFrame?.scopeReadyAt ?? shooter.scopeReadyAt
    const landingPenaltyUntil = shooterFrame?.landingPenaltyUntil ?? shooter.landingPenaltyUntil
    const scopePenalty = scopeReadyAt > targetTime
      ? 0.06 * Math.min(1, (scopeReadyAt - targetTime) / CS2_AWP_2026_08.scopeRecoveryMs)
      : 0
    const landingPenalty = landingPenaltyUntil > targetTime
      ? CS2_AWP_2026_08.inaccuracyLand * Math.min(1, (landingPenaltyUntil - targetTime) / CS2_AWP_2026_08.landingRecoveryMs)
      : 0
    const eyeHeight = shotState.crouching ? 1.05 : 1.64
    const origin = { x: shotState.position.x, y: shotState.position.y + eyeHeight, z: shotState.position.z }
    const spreadDirection = applyWeaponSpread(
      viewDirection(shotState.yaw, shotState.pitch),
      shotState,
      shooter.shotCounter + round.index * 10_000,
      scopePenalty + landingPenalty,
    )
    const mapDistance = rayMap(origin, spreadDirection)

    let nearest: { player: Player; hit: NonNullable<ReturnType<typeof rayPlayer>> } | null = null
    for (const target of this.players.values()) {
      if (target.id === shooter.id || target.state.role !== 'runner' || target.life !== 'alive') continue
      const frame = this.historyAt(target, targetTime)
      if (!frame || frame.life !== 'alive') continue
      const hit = rayPlayer(origin, spreadDirection, frame.state, frame.state.body)
      if (hit && (!nearest || hit.distance < nearest.hit.distance)) nearest = { player: target, hit }
    }

    const blocked = mapDistance != null && (!nearest || mapDistance < nearest.hit.distance)
    let result: HitResult = {
      shotId: event.shotId,
      shooterId: shooter.id,
      targetId: null,
      bodyPart: null,
      point: mapDistance == null ? null : {
        x: origin.x + spreadDirection.x * mapDistance,
        y: origin.y + spreadDirection.y * mapDistance,
        z: origin.z + spreadDirection.z * mapDistance,
      },
      detachedPart: null,
      fatal: false,
      blocked,
      damage: 0,
      remainingHealth: null,
    }

    if (nearest && !blocked) {
      const applied = applyHit(nearest.player.state.body, nearest.hit.part)
      nearest.player.state.body = applied.body
      if (applied.fatal) this.resolveRunner(nearest.player, 'dead', now)
      result = {
        ...result,
        targetId: nearest.player.id,
        bodyPart: nearest.hit.part,
        point: nearest.hit.point,
        detachedPart: applied.detachedPart,
        fatal: applied.fatal,
        blocked: false,
        damage: applied.damage,
        remainingHealth: applied.body.health,
      }
    }
    this.broadcast({ type: 'shot.result', payload: result })
    this.maybeFinishRound(now)
  }

  private historyAt(player: Player, targetTime: number) {
    let closest: HistoryFrame | null = null
    for (const frame of player.history) {
      if (frame.time <= targetTime) closest = frame
      else break
    }
    return closest ?? player.history[0] ?? null
  }

  private resolveRunner(player: Player, life: Extract<LifeState, 'escaped' | 'dead' | 'timed_out' | 'incapacitated'>, now: number) {
    if (!this.round || player.life !== 'alive') return
    player.life = life
    player.state.velocity = { x: 0, y: 0, z: 0 }
    this.round.completedRunnerIds.push(player.id)
    const sniper = this.players.get(this.round.sniperId)
    const elapsed = Math.max(0, now - this.round.startedAt)
    if (life === 'escaped') {
      player.score.duelWins += 1
      player.score.runnerEscapes += 1
      player.score.runnerEscapeTimeMs += elapsed
    } else if (sniper) {
      sniper.score.duelWins += 1
      sniper.score.sniperStops += 1
      sniper.score.sniperStopTimeMs += elapsed
    }
  }

  private maybeFinishRound(now: number) {
    if (!this.round || this.phase !== 'active') return
    const pending = [...this.players.values()].some(player => player.state.role === 'runner' && player.life === 'alive')
    if (pending) return
    this.phase = 'round_result'
    this.transitionAt = now + ROUND_RESULT_MS
    this.broadcast({ type: 'round.result', payload: { room: this.snapshot() } })
    this.broadcastRoom()
  }

  private cleanupDisconnected(now: number) {
    for (const player of [...this.players.values()]) {
      if (player.connected || player.disconnectedAt == null || now - player.disconnectedAt < RECONNECT_GRACE_MS) continue
      if (this.phase === 'lobby' || this.phase === 'match_result') {
        this.players.delete(player.id)
        if (this.hostId === player.id) this.hostId = this.players.keys().next().value ?? ''
      } else if (player.state.role === 'runner' && player.life === 'alive') {
        this.resolveRunner(player, 'timed_out', now)
      } else if (this.phase === 'active' && this.round?.sniperId === player.id) {
        this.resumeRound(now)
        for (const runner of this.players.values()) {
          if (runner.state.role === 'runner' && runner.life === 'alive') this.resolveRunner(runner, 'escaped', now)
        }
      }
    }
    if (this.players.size === 0) this.lastOccupiedAt = now
    if (this.phase === 'active') this.maybeFinishRound(now)
  }

  private resumeRound(now: number) {
    if (this.pausedAt == null || !this.round) return
    const pausedFor = now - this.pausedAt
    this.round.startedAt += pausedFor
    this.round.endsAt += pausedFor
    this.round.paused = false
    this.pausedAt = null
  }

  private broadcastRoom() {
    this.broadcast({ type: 'room.state', payload: this.snapshot() })
  }

  private sendError(player: Player | undefined, code: string, message: string) {
    if (player) this.send(player, { type: 'error', payload: { code, message } })
  }

  private send(player: Player, message: ServerMessage) {
    const socket = player.socket
    if (socket?.readyState === 1) socket.send(JSON.stringify(message))
  }

  private broadcast(message: ServerMessage) {
    const payload = JSON.stringify(message)
    for (const player of this.players.values()) {
      const socket = player.socket
      if (socket?.readyState === 1) socket.send(payload)
    }
  }
}

export function makeRoomCode(existing: Map<string, Room>) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (;;) {
    const bytes = randomBytes(6)
    let code = ''
    for (let index = 0; index < 6; index += 1) code += alphabet[bytes[index]! % alphabet.length]
    if (!existing.has(code)) return code
  }
}

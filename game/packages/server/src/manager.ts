import type WebSocket from 'ws'
import {
  EMPTY_ROOM_TTL_MS,
  SNAPSHOT_HZ,
  type ClientMessage,
  type ServerMessage,
} from '@trashbox/sniper-shared'
import { makeRoomCode, Room } from './room.js'

interface Session {
  room: Room
  playerId: string
}

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.type === 'string' && record.payload != null && typeof record.payload === 'object'
}

export class RoomManager {
  readonly rooms = new Map<string, Room>()
  private readonly sessions = new Map<WebSocket, Session>()
  private snapshotAccumulator = 0

  connect(socket: WebSocket) {
    socket.on('message', raw => {
      const byteLength = Array.isArray(raw) ? raw.reduce((total, chunk) => total + chunk.byteLength, 0) : raw.byteLength
      if (byteLength > 16 * 1024) return socket.close(1009, 'Payload too large')
      let message: unknown
      try {
        message = JSON.parse(raw.toString())
      } catch {
        return send(socket, { type: 'error', payload: { code: 'BAD_JSON', message: '消息格式无效。' } })
      }
      if (!isClientMessage(message)) return send(socket, { type: 'error', payload: { code: 'BAD_MESSAGE', message: '消息结构无效。' } })
      this.handle(socket, message)
    })
    socket.on('close', () => {
      const session = this.sessions.get(socket)
      if (session) session.room.disconnect(session.playerId, socket, Date.now())
      this.sessions.delete(socket)
    })
    socket.on('error', () => undefined)
  }

  tick(now: number, dt: number) {
    for (const room of this.rooms.values()) room.tick(now, dt)
    this.snapshotAccumulator += dt
    const snapshotInterval = 1 / SNAPSHOT_HZ
    if (this.snapshotAccumulator + Number.EPSILON >= snapshotInterval) {
      for (const room of this.rooms.values()) room.broadcastSnapshot(now)
      this.snapshotAccumulator %= snapshotInterval
    }
    for (const [code, room] of this.rooms) {
      if (room.size === 0 && now - room.lastOccupiedAt >= EMPTY_ROOM_TTL_MS) this.rooms.delete(code)
    }
  }

  private handle(socket: WebSocket, message: ClientMessage) {
    const now = Date.now()
    if (message.type === 'room.create') {
      if (this.sessions.has(socket)) return
      const room = new Room(makeRoomCode(this.rooms))
      this.rooms.set(room.code, room)
      const player = room.addPlayer(message.payload.name, socket)
      this.sessions.set(socket, { room, playerId: player.id })
      return
    }
    if (message.type === 'room.join') {
      if (this.sessions.has(socket)) return
      const room = this.rooms.get(String(message.payload.code).toUpperCase())
      if (!room) return send(socket, { type: 'error', payload: { code: 'ROOM_NOT_FOUND', message: '没有找到这个训练房间。' } })
      try {
        const player = room.addPlayer(message.payload.name, socket)
        this.sessions.set(socket, { room, playerId: player.id })
      } catch (error) {
        const code = error instanceof Error ? error.message : 'JOIN_FAILED'
        send(socket, { type: 'error', payload: { code, message: code === 'ROOM_FULL' ? '房间已满。' : '比赛已经开始。' } })
      }
      return
    }
    if (message.type === 'session.resume') {
      if (this.sessions.has(socket)) return
      for (const room of this.rooms.values()) {
        try {
          const player = room.resume(message.payload.playerId, message.payload.reconnectToken, socket)
          this.sessions.set(socket, { room, playerId: player.id })
          return
        } catch {
          // Continue searching without revealing room membership.
        }
      }
      return send(socket, { type: 'error', payload: { code: 'INVALID_SESSION', message: '重连凭证已失效，请重新进入房间。' } })
    }
    const session = this.sessions.get(socket)
    if (!session) return send(socket, { type: 'error', payload: { code: 'NO_SESSION', message: '请先创建或加入房间。' } })
    if (message.type === 'room.leave') {
      try {
        const result = session.room.leave(session.playerId, now)
        if (result.dissolved) {
          this.rooms.delete(session.room.code)
          for (const [sessionSocket, current] of this.sessions) {
            if (current.room === session.room) this.sessions.delete(sessionSocket)
          }
        } else this.sessions.delete(socket)
      } catch {
        send(socket, { type: 'error', payload: { code: 'CANNOT_LEAVE', message: '回合进行中不能直接退出房间。' } })
      }
      return
    }
    session.room.handle(session.playerId, message, now)
  }
}

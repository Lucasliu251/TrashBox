import type { ClientMessage, RoomSnapshot, ServerMessage } from '@trashbox/sniper-shared'

type MessageListener = (message: ServerMessage) => void
type StatusListener = (status: ConnectionStatus) => void
export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error'

const SESSION_KEY = 'blackline.session.v1'

interface StoredSession {
  playerId: string
  reconnectToken: string
  roomCode: string
}

/**
 * 解析 WebSocket 地址。
 * 优先使用构建时注入的 VITE_WS_URL；否则连接当前页面源 + Vite base + /ws，
 * 以便站点挂在 /trashbox/game/sniper 这类子路径时仍能打到同一反代。
 * @returns 浏览器 WebSocket 将要连接的绝对 URL
 *
 * @changelog
 * - 2026-08-22: 跟随 import.meta.env.BASE_URL，支持 Nginx 子路径反代
 */
function websocketUrl() {
  const configured = import.meta.env.VITE_WS_URL as string | undefined
  if (configured) return configured
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
  return `${protocol}//${location.host}${base}/ws`
}

export class GameConnection {
  playerId = ''
  roomCode = ''
  room: RoomSnapshot | null = null
  rttMs = 0
  status: ConnectionStatus = 'closed'
  private socket: WebSocket | null = null
  private reconnectToken = ''
  private messages = new Set<MessageListener>()
  private statuses = new Set<StatusListener>()
  private reconnectTimer = 0
  private intentionalClose = false
  private pingTimer = 0

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return
    this.intentionalClose = false
    this.setStatus('connecting')
    const socket = new WebSocket(websocketUrl())
    this.socket = socket

    socket.addEventListener('open', () => {
      this.setStatus('open')
      const stored = this.readSession()
      if (stored) {
        this.send({ type: 'session.resume', payload: { playerId: stored.playerId, reconnectToken: stored.reconnectToken } })
      }
      window.clearInterval(this.pingTimer)
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping', payload: { clientTime: performance.timeOrigin + performance.now() } }), 2000)
    })
    socket.addEventListener('message', event => this.receive(event.data))
    socket.addEventListener('close', () => {
      window.clearInterval(this.pingTimer)
      this.setStatus('closed')
      if (!this.intentionalClose) this.reconnectTimer = window.setTimeout(() => this.connect(), 900)
    })
    socket.addEventListener('error', () => this.setStatus('error'))
  }

  close() {
    this.intentionalClose = true
    window.clearTimeout(this.reconnectTimer)
    window.clearInterval(this.pingTimer)
    this.socket?.close()
  }

  createRoom(name: string) {
    this.clearSession()
    this.send({ type: 'room.create', payload: { name } })
  }

  joinRoom(code: string, name: string) {
    this.clearSession()
    this.send({ type: 'room.join', payload: { code: code.trim().toUpperCase(), name } })
  }

  leaveRoom() {
    this.send({ type: 'room.leave', payload: {} })
  }

  send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  onMessage(listener: MessageListener) {
    this.messages.add(listener)
    return () => { this.messages.delete(listener) }
  }

  onStatus(listener: StatusListener) {
    this.statuses.add(listener)
    return () => { this.statuses.delete(listener) }
  }

  private receive(raw: unknown) {
    if (typeof raw !== 'string') return
    try {
      const message = JSON.parse(raw) as ServerMessage
      if (message.type === 'session.welcome') {
        this.playerId = message.payload.playerId
        this.roomCode = message.payload.roomCode
        this.reconnectToken = message.payload.reconnectToken
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
          playerId: this.playerId,
          roomCode: this.roomCode,
          reconnectToken: this.reconnectToken,
        } satisfies StoredSession))
      }
      if (message.type === 'room.state' || message.type === 'state.snapshot') {
        this.room = message.type === 'room.state' ? message.payload : message.payload.room
        this.roomCode = this.room.code
      }
      if (message.type === 'session.left' || message.type === 'room.closed') this.clearSession()
      if (message.type === 'pong') this.rttMs = Math.max(0, performance.timeOrigin + performance.now() - message.payload.clientTime)
      for (const listener of this.messages) listener(message)
    } catch {
      // Ignore malformed server frames. The socket remains usable for later snapshots.
    }
  }

  private readSession(): StoredSession | null {
    try {
      const value = sessionStorage.getItem(SESSION_KEY)
      return value ? JSON.parse(value) as StoredSession : null
    } catch {
      return null
    }
  }

  private clearSession() {
    sessionStorage.removeItem(SESSION_KEY)
    this.playerId = ''
    this.reconnectToken = ''
    this.roomCode = ''
    this.room = null
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status
    for (const listener of this.statuses) listener(status)
  }
}

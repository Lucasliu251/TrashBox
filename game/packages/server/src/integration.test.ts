import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { CS2_AWP_2026_08, SIMULATION_DT, type ClientMessage, type ServerMessage } from '@trashbox/sniper-shared'
import { RoomManager } from './manager.js'

class Probe {
  readonly messages: ServerMessage[] = []
  readonly socket: WebSocket

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.on('message', raw => this.messages.push(JSON.parse(raw.toString()) as ServerMessage))
  }

  static async connect(url: string) {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    return new Probe(socket)
  }

  send(message: ClientMessage) {
    this.socket.send(JSON.stringify(message))
  }

  async waitFor<T extends ServerMessage>(predicate: (message: ServerMessage) => message is T, after = 0): Promise<T> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const found = this.messages.slice(after).find(predicate)
      if (found) return found
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error(`Timed out waiting for server message; received ${this.messages.slice(after).map(message => message.type).join(', ')}`)
  }

  close() {
    this.socket.terminate()
  }
}

const isType = <T extends ServerMessage['type']>(type: T) =>
  (message: ServerMessage): message is Extract<ServerMessage, { type: T }> => message.type === type

describe('five-player websocket room', () => {
  let http: Server | null = null
  let sockets: Probe[] = []

  afterEach(async () => {
    for (const probe of sockets) probe.close()
    sockets = []
    if (http) await new Promise<void>(resolve => http!.close(() => resolve()))
    http = null
  })

  it('creates, fills, resumes and rotates every player through sniper', async () => {
    const manager = new RoomManager()
    http = createServer()
    const wss = new WebSocketServer({ server: http, path: '/ws', perMessageDeflate: false })
    wss.on('connection', socket => manager.connect(socket))
    await new Promise<void>((resolve, reject) => {
      http!.once('error', reject)
      http!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = http.address()
    if (!address || typeof address === 'string') throw new Error('Missing test port')
    const url = `ws://127.0.0.1:${address.port}/ws`

    const host = await Probe.connect(url)
    sockets.push(host)
    host.send({ type: 'room.create', payload: { name: 'Host' } })
    const hostWelcome = await host.waitFor(isType('session.welcome'))
    const roomCode = hostWelcome.payload.roomCode

    const welcomes = [hostWelcome]
    for (let index = 1; index < 5; index += 1) {
      const probe = await Probe.connect(url)
      sockets.push(probe)
      probe.send({ type: 'room.join', payload: { code: roomCode, name: `P${index + 1}` } })
      welcomes.push(await probe.waitFor(isType('session.welcome')))
    }

    const overflow = await Probe.connect(url)
    sockets.push(overflow)
    overflow.send({ type: 'room.join', payload: { code: roomCode, name: 'Overflow' } })
    const full = await overflow.waitFor(isType('error'))
    expect(full.payload.code).toBe('ROOM_FULL')
    overflow.close()
    sockets.pop()

    const oldSecond = sockets[1]!
    const oldSecondClosed = new Promise<void>(resolve => oldSecond.socket.once('close', () => resolve()))
    const resumed = await Probe.connect(url)
    resumed.send({
      type: 'session.resume',
      payload: {
        playerId: welcomes[1]!.payload.playerId,
        reconnectToken: welcomes[1]!.payload.reconnectToken,
      },
    })
    const resumedWelcome = await resumed.waitFor(isType('session.welcome'))
    expect(resumedWelcome.payload.reconnectToken).not.toBe(welcomes[1]!.payload.reconnectToken)
    sockets[1] = resumed
    await oldSecondClosed

    const room = manager.rooms.get(roomCode)
    if (!room) throw new Error('Room not created')
    expect(room.snapshot().players.find(player => player.id === resumedWelcome.payload.playerId)?.connected).toBe(true)

    const snapshotCursor = resumed.messages.length
    let tickNow = Date.now()
    for (let tick = 0; tick < 128; tick += 1) {
      tickNow += 1000 / 128
      manager.tick(tickNow, SIMULATION_DT)
      if (tick % 8 === 7) await new Promise(resolve => setTimeout(resolve, 0))
    }
    for (let attempt = 0; attempt < 100 && resumed.messages.slice(snapshotCursor).filter(isType('state.snapshot')).length < 128; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(resumed.messages.slice(snapshotCursor).filter(isType('state.snapshot'))).toHaveLength(128)

    for (const probe of sockets) probe.send({ type: 'room.ready', payload: { ready: true } })
    for (let attempt = 0; attempt < 100 && !room.snapshot().players.every(player => player.ready); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(room.snapshot().players).toHaveLength(5)
    expect(room.snapshot().players.every(player => player.ready)).toBe(true)

    host.send({ type: 'room.start', payload: {} })
    for (let attempt = 0; attempt < 100 && room.phase !== 'active'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
    expect(room.phase).toBe('active')

    const shotCursor = host.messages.length
    host.send({ type: 'shot.fire', payload: { shotId: 'reload-test-shot', inputSeq: 0, clientTime: Date.now(), rttMs: 0 } })
    await host.waitFor(isType('shot.result'), shotCursor)
    const reloadCursor = resumed.messages.length
    host.send({ type: 'weapon.reload', payload: {} })
    const reloadStarted = await resumed.waitFor(isType('weapon.reload.started'), reloadCursor)
    expect(reloadStarted.payload.playerId).toBe(welcomes[0]!.payload.playerId)
    expect(reloadStarted.payload.endsAt - reloadStarted.payload.startedAt).toBe(CS2_AWP_2026_08.reloadTimeMs)

    const sniperRotation: string[] = []
    for (let roundIndex = 0; roundIndex < 5; roundIndex += 1) {
      expect(room.round?.index).toBe(roundIndex)
      sniperRotation.push(room.round!.sniperId)
      manager.tick(room.round!.endsAt + 1, SIMULATION_DT)
      expect(room.phase).toBe('round_result')
      manager.tick(room.transitionAt! + 1, SIMULATION_DT)
    }
    expect(new Set(sniperRotation).size).toBe(5)
    expect(room.phase).toBe('match_result')
    expect(room.snapshot().scores.reduce((sum, score) => sum + score.duelWins, 0)).toBe(20)
    const closeCursor = sockets[2]!.messages.length
    host.send({ type: 'room.leave', payload: {} })
    const closed = await sockets[2]!.waitFor(isType('room.closed'), closeCursor)
    expect(closed.payload.roomCode).toBe(roomCode)
    expect(manager.rooms.has(roomCode)).toBe(false)
    wss.close()
  }, 10_000)
})

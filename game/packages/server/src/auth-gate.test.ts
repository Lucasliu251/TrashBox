import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import WebSocket from 'ws'

let game: ChildProcess | null = null
let central: Server | null = null
let frontend: Server | null = null
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate()
  if (game) {
    const child = game
    if (child.exitCode == null) {
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
      child.kill('SIGTERM')
      await exited
    }
    game = null
  }
  if (central) await new Promise<void>(resolve => central!.close(() => resolve()))
  central = null
  if (frontend) await new Promise<void>(resolve => frontend!.close(() => resolve()))
  frontend = null
})

it('gates direct-port HTML, static resources and websocket upgrades with the central cookie', async () => {
  let allowSession = true
  central = createServer((request, response) => {
    if (request.url?.startsWith('/api/v1/web-auth/challenges')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ challenge: 'public-qr-bootstrap' }))
      return
    }
    response.writeHead(allowSession && request.headers.cookie === 'trashbox_session=valid' ? 204 : 401)
    response.end()
  })
  await new Promise<void>((resolve, reject) => {
    central!.once('error', reject)
    central!.listen(0, '127.0.0.1', () => resolve())
  })
  const centralAddress = central.address()
  if (!centralAddress || typeof centralAddress === 'string') throw new Error('Missing auth port')
  frontend = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('central-login-entry')
  })
  await new Promise<void>((resolve, reject) => {
    frontend!.once('error', reject)
    frontend!.listen(0, '127.0.0.1', () => resolve())
  })
  const frontendAddress = frontend.address()
  if (!frontendAddress || typeof frontendAddress === 'string') throw new Error('Missing frontend port')
  game = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./index.ts', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      HOST: '127.0.0.1', PORT: '0', BASE_PATH: '/game/sniper',
      TRASHBOX_AUTH_CHECK_URL: `http://127.0.0.1:${centralAddress.port}/api/v1/auth/check`,
      TRASHBOX_LOGIN_URL: '/login', TRASHBOX_AUTH_FRONTEND_ORIGIN: `http://127.0.0.1:${frontendAddress.port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Game did not start')), 5000)
    game!.once('error', reject)
    game!.stdout!.on('data', data => {
      const match = String(data).match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)
      if (match) { clearTimeout(timeout); resolve(Number(match[1])) }
    })
    game!.stderr!.on('data', data => { clearTimeout(timeout); reject(new Error(String(data))) })
  })
  const origin = `http://127.0.0.1:${port}`
  const page = await fetch(`${origin}/game/sniper/?room=abc`, { redirect: 'manual' })
  expect(page.status).toBe(302)
  expect(page.headers.get('location')).toBe('/login?return_to=%2Fgame%2Fsniper%2F%3Froom%3Dabc')
  expect(await (await fetch(`${origin}/login`)).text()).toBe('central-login-entry')
  expect((await fetch(`${origin}/account`, { redirect: 'manual' })).status).toBe(302)
  expect(await (await fetch(`${origin}/account`, { headers: { cookie: 'trashbox_session=valid' } })).text()).toBe('central-login-entry')
  expect(await (await fetch(`${origin}/api/v1/web-auth/challenges`, { method: 'POST' })).json()).toEqual({ challenge: 'public-qr-bootstrap' })
  expect((await fetch(`${origin}/game/sniper/assets/app.js`)).status).toBe(401)
  expect((await fetch(`${origin}/game/sniper/ws`, { headers: { accept: 'text/html' } })).status).toBe(401)
  expect((await fetch(`${origin}/game/sniper/`, { headers: { cookie: 'trashbox_session=valid' } })).status).toBe(200)

  const rejectedUpgrade = () => new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/game/sniper/ws`, { headers: { Cookie: 'trashbox_session=valid' } })
    sockets.push(socket)
    socket.on('error', () => {})
    socket.once('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode || 0) })
    socket.once('open', () => reject(new Error('Unauthorized upgrade accepted')))
  })
  const authenticated = new WebSocket(`ws://127.0.0.1:${port}/game/sniper/ws`, { headers: { Cookie: 'trashbox_session=valid' } })
  sockets.push(authenticated)
  await new Promise<void>((resolve, reject) => { authenticated.once('open', () => resolve()); authenticated.once('error', reject) })
  allowSession = false
  expect(await rejectedUpgrade()).toBe(401)
  expect((await fetch(`${origin}/game/sniper/assets/app.js`, { headers: { cookie: 'trashbox_session=valid' } })).status).toBe(401)
}, 10_000)

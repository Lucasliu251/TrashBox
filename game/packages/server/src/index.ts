/**
 * @fileoverview BLACKLINE 权威服务器入口
 * @description 同一 HTTP 进程提供客户端静态资源、/healthz 与 /ws；可通过 BASE_PATH 挂到 Nginx 子路径。
 * @author TrashBox
 * @since 2026-08-22
 */
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sirv from 'sirv'
import { WebSocketServer } from 'ws'
import { SIMULATION_DT, SIMULATION_HZ } from '@trashbox/sniper-shared'
import { isHealthzPath, normalizeBasePath, requestPathname, stripBasePath } from './http-path.js'
import { centralAuthUrl, hasSession, isPageRequest, loginRedirect } from './auth.js'
import { proxyAuth } from './auth-proxy.js'
import { RoomManager } from './manager.js'

const port = Number(process.env.PORT || 8080)
const host = process.env.HOST || '0.0.0.0'
const basePath = normalizeBasePath(process.env.BASE_PATH)
const websocketPath = `${basePath}/ws`
const currentDir = dirname(fileURLToPath(import.meta.url))
const clientDist = resolve(currentDir, '../../client/dist')
const serveClient = sirv(clientDist, { single: true, dev: process.env.NODE_ENV !== 'production' })
const manager = new RoomManager()
const authCheckUrl = centralAuthUrl(process.env.TRASHBOX_AUTH_CHECK_URL || 'http://127.0.0.1:2026/api/v1/auth/check')
const loginUrl = process.env.TRASHBOX_LOGIN_URL || '/login'
const authFrontendOrigin = process.env.TRASHBOX_AUTH_FRONTEND_ORIGIN
  ? centralAuthUrl(process.env.TRASHBOX_AUTH_FRONTEND_ORIGIN)
  : null

const server = createServer(async (request, response) => {
  response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  const url = request.url || '/'
  if (isHealthzPath(url, basePath)) {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ ok: true }))
    return
  }

  const pathname = requestPathname(url)
  if (authFrontendOrigin && (pathname === '/login' || pathname.startsWith('/auth/'))) {
    proxyAuth(request, response, authFrontendOrigin)
    return
  }
  if (authFrontendOrigin && (pathname === '/api/v1/auth' || pathname.startsWith('/api/v1/auth/') ||
    pathname === '/api/v1/web-auth/challenges' || pathname.startsWith('/api/v1/web-auth/challenges/'))) {
    proxyAuth(request, response, new URL('/', authCheckUrl))
    return
  }
  if (!await hasSession(request.headers.cookie, authCheckUrl)) {
    response.setHeader('Cache-Control', 'no-store')
    if (isPageRequest(request, pathname)) {
      response.writeHead(302, { location: loginRedirect(loginUrl, url) })
      response.end()
    } else {
      response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ detail: 'Authentication required' }))
    }
    return
  }
  if (authFrontendOrigin && pathname === '/account') {
    proxyAuth(request, response, authFrontendOrigin)
    return
  }
  if (basePath && (pathname === '/' || pathname === '')) {
    response.writeHead(308, { location: `${basePath}/` })
    response.end()
    return
  }
  if (basePath && pathname === basePath) {
    const queryIndex = url.indexOf('?')
    const query = queryIndex === -1 ? '' : url.slice(queryIndex)
    response.writeHead(308, { location: `${basePath}/${query}` })
    response.end()
    return
  }

  const stripped = stripBasePath(url, basePath)
  if (stripped == null) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }
  request.url = stripped
  serveClient(request, response)
})

const webSockets = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  maxPayload: 16 * 1024,
})
server.on('upgrade', async (request, socket, head) => {
  socket.on('error', () => {})
  if (requestPathname(request.url || '/') !== websocketPath) {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
    return
  }
  if (!await hasSession(request.headers.cookie, authCheckUrl)) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n')
    return
  }
  if (!socket.destroyed) webSockets.handleUpgrade(request, socket, head, client => {
    webSockets.emit('connection', client, request)
  })
})
webSockets.on('connection', (socket, request) => {
  manager.connect(socket)
  // Re-check idle sockets too, so logout/revocation cannot leave an open game session.
  const interval = setInterval(async () => {
    if (!await hasSession(request.headers.cookie, authCheckUrl)) socket.close(4401, 'Authentication required')
  }, 60_000)
  interval.unref()
  socket.on('close', () => clearInterval(interval))
})

let previous = performance.now()
let accumulator = 0
const frameMs = 1000 / SIMULATION_HZ
const loop = () => {
  const current = performance.now()
  accumulator += Math.min(current - previous, 250)
  previous = current
  let steps = 0
  while (accumulator >= frameMs && steps < 8) {
    manager.tick(Date.now(), SIMULATION_DT)
    accumulator -= frameMs
    steps += 1
  }
  setTimeout(loop, Math.max(0, frameMs - accumulator))
}

server.listen(port, host, () => {
  const publicPath = `${basePath}/`
  const address = server.address()
  const boundPort = address && typeof address !== 'string' ? address.port : port
  process.stdout.write(`BLACKLINE server listening on http://${host}:${boundPort}${publicPath}\n`)
  process.stdout.write(`WebSocket path ${websocketPath}\n`)
  loop()
})

const shutdown = () => {
  webSockets.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

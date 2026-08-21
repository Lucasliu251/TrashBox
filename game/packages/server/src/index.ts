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
import { RoomManager } from './manager.js'

const port = Number(process.env.PORT || 8080)
const host = process.env.HOST || '0.0.0.0'
const basePath = normalizeBasePath(process.env.BASE_PATH)
const websocketPath = `${basePath}/ws`
const currentDir = dirname(fileURLToPath(import.meta.url))
const clientDist = resolve(currentDir, '../../client/dist')
const serveClient = sirv(clientDist, { single: true, dev: process.env.NODE_ENV !== 'production' })
const manager = new RoomManager()

const server = createServer((request, response) => {
  const url = request.url || '/'
  if (isHealthzPath(url, basePath)) {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ ok: true, rooms: manager.rooms.size, now: Date.now(), basePath: basePath || '/' }))
    return
  }

  const pathname = requestPathname(url)
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
  server,
  path: websocketPath,
  perMessageDeflate: false,
  maxPayload: 16 * 1024,
})
webSockets.on('connection', socket => manager.connect(socket))

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
  process.stdout.write(`BLACKLINE server listening on http://${host}:${port}${publicPath}\n`)
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

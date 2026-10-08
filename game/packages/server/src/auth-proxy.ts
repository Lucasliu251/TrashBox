import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'

/** Local preview keeps login, cookie callbacks and the game on the same browser origin. */
export function proxyAuth(request: IncomingMessage, response: ServerResponse, origin: URL): void {
  const target = new URL(request.url || '/', origin)
  const headers = { ...request.headers, host: target.host }
  delete headers.connection
  delete headers.upgrade
  const upstream = httpRequest(target, { method: request.method, headers }, result => {
    response.writeHead(result.statusCode || 502, {
      ...result.headers,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive',
    })
    result.pipe(response)
  })
  upstream.setTimeout(10_000, () => upstream.destroy())
  upstream.on('error', () => {
    if (response.headersSent) response.destroy()
    else {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ detail: 'Login service unavailable' }))
    }
  })
  request.on('aborted', () => upstream.destroy())
  request.pipe(upstream)
}

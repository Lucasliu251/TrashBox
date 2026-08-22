import { describe, expect, it } from 'vitest'
import { isHealthzPath, normalizeBasePath, requestPathname, stripBasePath } from './http-path.js'

describe('normalizeBasePath', () => {
  it('treats missing, empty and root values as no prefix', () => {
    expect(normalizeBasePath(undefined)).toBe('')
    expect(normalizeBasePath('')).toBe('')
    expect(normalizeBasePath(' / ')).toBe('')
    expect(normalizeBasePath('/')).toBe('')
  })

  it('collapses slashes and drops a trailing slash', () => {
    expect(normalizeBasePath('game/sniper')).toBe('/game/sniper')
    expect(normalizeBasePath('/game/sniper/')).toBe('/game/sniper')
    expect(normalizeBasePath('///game//sniper///')).toBe('/game/sniper')
  })
})

describe('requestPathname', () => {
  it('drops the query string', () => {
    expect(requestPathname('/game/sniper?room=ABC123')).toBe('/game/sniper')
  })
})

describe('isHealthzPath', () => {
  it('always accepts the unprefixed probe', () => {
    expect(isHealthzPath('/healthz', '')).toBe(true)
    expect(isHealthzPath('/healthz', '/game/sniper')).toBe(true)
    expect(isHealthzPath('/healthz?fresh=1', '/game/sniper')).toBe(true)
  })

  it('accepts the prefixed probe when a base path is configured', () => {
    expect(isHealthzPath('/game/sniper/healthz', '/game/sniper')).toBe(true)
    expect(isHealthzPath('/game/sniper/ws', '/game/sniper')).toBe(false)
  })
})

describe('stripBasePath', () => {
  it('leaves root-hosted URLs unchanged', () => {
    expect(stripBasePath('/assets/app.js', '')).toBe('/assets/app.js')
    expect(stripBasePath('/?room=ABC123', '')).toBe('/?room=ABC123')
  })

  it('maps the public prefix onto the client dist root', () => {
    expect(stripBasePath('/game/sniper', '/game/sniper')).toBe('/')
    expect(stripBasePath('/game/sniper/', '/game/sniper')).toBe('/')
    expect(stripBasePath('/game/sniper/assets/app.js', '/game/sniper')).toBe('/assets/app.js')
    expect(stripBasePath('/game/sniper/?room=ABC123', '/game/sniper')).toBe('/?room=ABC123')
  })

  it('rejects URLs outside the public prefix', () => {
    expect(stripBasePath('/', '/game/sniper')).toBeNull()
    expect(stripBasePath('/game/other', '/game/sniper')).toBeNull()
  })
})

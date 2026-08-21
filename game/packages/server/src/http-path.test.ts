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
    expect(normalizeBasePath('trashbox/game/sniper')).toBe('/trashbox/game/sniper')
    expect(normalizeBasePath('/trashbox/game/sniper/')).toBe('/trashbox/game/sniper')
    expect(normalizeBasePath('///trashbox//game/sniper///')).toBe('/trashbox/game/sniper')
  })
})

describe('requestPathname', () => {
  it('drops the query string', () => {
    expect(requestPathname('/trashbox/game/sniper?room=ABC123')).toBe('/trashbox/game/sniper')
  })
})

describe('isHealthzPath', () => {
  it('always accepts the unprefixed probe', () => {
    expect(isHealthzPath('/healthz', '')).toBe(true)
    expect(isHealthzPath('/healthz', '/trashbox/game/sniper')).toBe(true)
    expect(isHealthzPath('/healthz?fresh=1', '/trashbox/game/sniper')).toBe(true)
  })

  it('accepts the prefixed probe when a base path is configured', () => {
    expect(isHealthzPath('/trashbox/game/sniper/healthz', '/trashbox/game/sniper')).toBe(true)
    expect(isHealthzPath('/trashbox/game/sniper/ws', '/trashbox/game/sniper')).toBe(false)
  })
})

describe('stripBasePath', () => {
  it('leaves root-hosted URLs unchanged', () => {
    expect(stripBasePath('/assets/app.js', '')).toBe('/assets/app.js')
    expect(stripBasePath('/?room=ABC123', '')).toBe('/?room=ABC123')
  })

  it('maps the public prefix onto the client dist root', () => {
    expect(stripBasePath('/trashbox/game/sniper', '/trashbox/game/sniper')).toBe('/')
    expect(stripBasePath('/trashbox/game/sniper/', '/trashbox/game/sniper')).toBe('/')
    expect(stripBasePath('/trashbox/game/sniper/assets/app.js', '/trashbox/game/sniper')).toBe('/assets/app.js')
    expect(stripBasePath('/trashbox/game/sniper/?room=ABC123', '/trashbox/game/sniper')).toBe('/?room=ABC123')
  })

  it('rejects URLs outside the public prefix', () => {
    expect(stripBasePath('/', '/trashbox/game/sniper')).toBeNull()
    expect(stripBasePath('/trashbox/game/other', '/trashbox/game/sniper')).toBeNull()
  })
})

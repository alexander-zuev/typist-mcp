import { describe, expect, it } from 'vitest'
import { GrantRateLimiter } from '../../src/rate-limit'

function fakeNamespace(stub: { checkRateLimit: (...args: unknown[]) => Promise<unknown> }) {
  return {
    idFromName: () => ({}),
    get: () => stub,
  } as unknown as DurableObjectNamespace
}

describe('GrantRateLimiter', () => {
  it('passes the DO decision through', async () => {
    const limiter = new GrantRateLimiter(
      fakeNamespace({
        checkRateLimit: async () => ({ allowed: false, remaining: 0, retryAfter: 12 }),
      }),
    )
    expect(await limiter.check('mcp:test:u1', 60, 60_000)).toEqual({
      allowed: false,
      retryAfter: 12,
    })
  })

  it('fails open when the DO is unreachable', async () => {
    const limiter = new GrantRateLimiter(
      fakeNamespace({
        checkRateLimit: async () => {
          throw new Error('DO unreachable')
        },
      }),
    )
    expect(await limiter.check('mcp:test:u2', 60, 60_000)).toEqual({
      allowed: true,
      retryAfter: null,
    })
  })
})

import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers'

/**
 * Test stand-in for the main worker's side of the frozen contract
 * (`McpGatewayContract` + `RateLimiterRpc`). Behavior is keyed off inputs so
 * tests stay declarative:
 * - cookie `typist_session=<userId>` resolves a session; `typist_anon=1` marks it anonymous
 * - transcript id ending in `404` returns a NOT_FOUND error envelope
 * - userId containing `ratelimited` is denied by the rate limiter
 * - userId containing `gatewaydown` returns a safe infrastructure error envelope
 */

const NOT_FOUND_ID = '00000000-0000-4000-8000-000000000404'
const ok = (value) => ({ status: 'ok', value })
const unavailable = () => ({
  status: 'error',
  error: {
    code: 'INFRASTRUCTURE_ERROR',
    message: 'Something went wrong',
    retryable: true,
  },
})
const notFound = () => ({
  status: 'error',
  error: {
    code: 'NOT_FOUND',
    message: 'Transcript not found',
    retryable: false,
  },
})

const ITEMS = (userId) => [
  {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: `Mining Conference Keynote (owner ${userId})`,
    duration: 3600,
    uploadedAt: '2026-07-20T10:00:00.000Z',
    category: 'lecture',
    topics: ['mining', 'copper'],
    locked: false,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: 'Locked Earnings Call',
    duration: 1800,
    uploadedAt: '2026-07-19T09:00:00.000Z',
    category: null,
    topics: null,
    locked: true,
  },
]

const META = {
  displayName: 'Mining Conference Keynote',
  language: 'en',
  duration: 3600,
  category: 'lecture',
  topics: ['mining'],
  locked: false,
}

export class McpGateway extends WorkerEntrypoint {
  async getSession(cookieHeader) {
    const match = /typist_session=([^;\s]+)/.exec(cookieHeader)
    if (!match) return ok(null)
    return ok({ userId: match[1], isAnonymous: /typist_anon=1/.test(cookieHeader) })
  }

  async searchTranscripts(userId, input) {
    if (userId.includes('gatewaydown')) return unavailable()
    return ok({
      items: ITEMS(`${userId} query=${input.query ?? 'none'}`),
      nextCursor: input.cursor ? undefined : 'cursor-page-2',
    })
  }

  async readTranscript(userId, input) {
    if (userId.includes('gatewaydown')) return unavailable()
    if (input.id === NOT_FOUND_ID) return ok({ kind: 'not_found', id: input.id })
    return ok({
      kind: 'found',
      id: input.id,
      ...META,
      text: `chunk for ${userId} offset=${input.offset} maxChars=${input.maxChars} format=${input.format}`,
      offset: input.offset,
      nextOffset: input.offset === 0 ? input.maxChars : undefined,
      totalChars: 100_000,
      truncated: input.offset === 0,
    })
  }

  async downloadTranscript(userId, input) {
    if (userId.includes('gatewaydown')) return unavailable()
    if (input.id === NOT_FOUND_ID) return notFound()
    return ok({
      downloadUrl: 'https://r2.test/export.txt?sig=abc',
      expiresAt: '2026-07-24T20:00:00.000Z',
      format: input.format,
    })
  }
}

export class FakeRateLimiterDO extends DurableObject {
  async checkRateLimit(key, maxRequests) {
    if (key.includes('ratelimited')) return { allowed: false, remaining: 0, retryAfter: 30 }
    return { allowed: true, remaining: maxRequests - 1, retryAfter: null }
  }
}

export default {
  fetch() {
    return new Response('fixture worker', { status: 404 })
  },
}

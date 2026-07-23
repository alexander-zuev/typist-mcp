import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers'

/**
 * Test stand-in for the main worker's side of the frozen contract
 * (`McpGatewayContract` + `RateLimiterRpc`). Behavior is keyed off inputs so
 * tests stay declarative:
 * - cookie `typist_session=<userId>` resolves a session; `typist_anon=1` marks it anonymous
 * - transcript id ending in `404` throws an EntityNotFoundError-shaped error
 * - userId containing `rate-limited` is denied by the rate limiter
 * - userId containing `gateway-down` makes tool calls throw a generic error
 */

const NOT_FOUND_ID = '00000000-0000-4000-8000-000000000404'

export class McpGateway extends WorkerEntrypoint {
  async getSession(cookieHeader) {
    const match = /typist_session=([^;\s]+)/.exec(cookieHeader)
    if (!match) return null
    return { userId: match[1], isAnonymous: /typist_anon=1/.test(cookieHeader) }
  }

  async searchTranscripts(userId, input) {
    if (userId.includes('gateway-down')) throw new Error('D1_ERROR: internal details')
    return {
      items: [
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
      ],
      nextCursor: input.cursor ? undefined : 'cursor-page-2',
    }
  }

  async getTranscriptChunk(userId, input) {
    if (userId.includes('gateway-down')) throw new Error('D1_ERROR: internal details')
    if (input.id === NOT_FOUND_ID) return { kind: 'not_found', id: input.id }
    if (input.delivery === 'url') {
      return {
        kind: 'url',
        id: input.id,
        displayName: 'Mining Conference Keynote',
        language: 'en',
        duration: 3600,
        category: 'lecture',
        topics: ['mining'],
        locked: false,
        url: 'https://r2.test/export.txt?sig=abc',
        expiresAt: '2026-07-23T20:00:00.000Z',
        format: input.format,
      }
    }
    return {
      kind: 'inline',
      id: input.id,
      displayName: 'Mining Conference Keynote',
      language: 'en',
      duration: 3600,
      category: 'lecture',
      topics: ['mining'],
      locked: false,
      text: `chunk for ${userId} offset=${input.offset} maxChars=${input.maxChars} format=${input.format}`,
      offset: input.offset,
      nextOffset: input.offset === 0 ? input.maxChars : undefined,
      totalChars: 100_000,
      truncated: input.offset === 0,
    }
  }
}

export class FakeRateLimiterDO extends DurableObject {
  async checkRateLimit(key, maxRequests) {
    if (key.includes('rate-limited')) return { allowed: false, remaining: 0, retryAfter: 30 }
    return { allowed: true, remaining: maxRequests - 1, retryAfter: null }
  }
}

export default {
  fetch() {
    return new Response('fixture worker', { status: 404 })
  },
}

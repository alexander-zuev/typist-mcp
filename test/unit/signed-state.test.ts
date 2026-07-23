import type { AuthRequest } from '@cloudflare/workers-oauth-provider'
import type { UserId } from '@typist/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signOAuthState, verifyOAuthState } from '../../src/signed-state'

const SECRET = 'unit-test-secret'
const USER_ID = '99999999-9999-4999-8999-999999999999' as UserId

const oauthReq: AuthRequest = {
  responseType: 'code',
  clientId: 'client-1',
  redirectUri: 'https://client.test/callback',
  scope: ['transcripts:read'],
  state: 'client-state',
  codeChallenge: 'challenge',
  codeChallengeMethod: 'S256',
}

afterEach(() => {
  vi.useRealTimers()
})

describe('signed OAuth state', () => {
  it('round-trips the request and userId', async () => {
    const state = await signOAuthState(SECRET, oauthReq, USER_ID)
    const verified = await verifyOAuthState(SECRET, state)
    expect(verified?.oauthReq).toEqual(oauthReq)
    expect(verified?.userId).toBe(USER_ID)
  })

  it('rejects a tampered payload', async () => {
    const state = await signOAuthState(SECRET, oauthReq, USER_ID)
    const [body, signature] = state.split('.')
    const tamperedBody = body!.slice(0, -2) + (body!.endsWith('aa') ? 'bb' : 'aa')
    expect(await verifyOAuthState(SECRET, `${tamperedBody}.${signature}`)).toBeNull()
  })

  it('rejects a state signed with a different secret', async () => {
    const state = await signOAuthState('other-secret', oauthReq, USER_ID)
    expect(await verifyOAuthState(SECRET, state)).toBeNull()
  })

  it('rejects malformed input', async () => {
    expect(await verifyOAuthState(SECRET, 'not-a-state')).toBeNull()
    expect(await verifyOAuthState(SECRET, '')).toBeNull()
    expect(await verifyOAuthState(SECRET, 'a.b.c')).toBeNull()
  })

  it('expires after its TTL', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-23T10:00:00Z'))
    const state = await signOAuthState(SECRET, oauthReq, USER_ID)
    vi.setSystemTime(new Date('2026-07-23T10:11:00Z'))
    expect(await verifyOAuthState(SECRET, state)).toBeNull()
  })
})

import { describe, expect, it, vi } from './test'

import {
  fingerprintOAuthState,
  OAuthStateReplayStore,
} from '../../src/infrastructure/auth/oauth-state-replay-store'

describe('OAuthStateReplayStore', () => {
  it('checks a hashed key instead of exposing the signed state', async () => {
    const get = vi.fn().mockResolvedValue('1')
    const store = new OAuthStateReplayStore({ get, put: vi.fn() })
    expect(await store.wasUsed('sensitive-state')).toBe(true)
    expect(get.mock.calls[0]?.[0]).toMatch(/^consent-state-used:[a-f0-9]{64}$/)
  })

  it('retains the replay marker beyond signed-state expiry', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    const store = new OAuthStateReplayStore({ get: vi.fn(), put })
    await store.markUsed('signed-state')
    expect(put).toHaveBeenCalledWith(expect.any(String), '1', { ttl: 660 })
  })

  it('derives a stable, non-sensitive correlation identifier', async () => {
    const first = await fingerprintOAuthState('signed-state')
    expect(await fingerprintOAuthState('signed-state')).toBe(first)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })
})

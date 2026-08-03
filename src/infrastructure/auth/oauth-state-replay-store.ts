import type { KVClient } from '@typist/core'

import { OAUTH_STATE_TTL_SECONDS } from './signed-state'

const REPLAY_MARKER_BUFFER_SECONDS = 60

type OAuthStateReplayStorage = Pick<KVClient, 'get' | 'put'>

/** Persists best-effort replay markers without exposing signed OAuth state in KV keys. */
export class OAuthStateReplayStore {
  constructor(private readonly storage: OAuthStateReplayStorage) {}

  async wasUsed(state: string): Promise<boolean> {
    return (await this.storage.get(await stateUsedKey(state))) !== null
  }

  async markUsed(state: string): Promise<void> {
    await this.storage.put(await stateUsedKey(state), '1', {
      ttl: OAUTH_STATE_TTL_SECONDS + REPLAY_MARKER_BUFFER_SECONDS,
    })
  }
}

async function stateUsedKey(state: string): Promise<string> {
  return `consent-state-used:${await fingerprintOAuthState(state)}`
}

/** Stable, non-sensitive identifier for correlating consent attempts and outcomes. */
export async function fingerprintOAuthState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

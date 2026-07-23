import type { AuthRequest } from '@cloudflare/workers-oauth-provider'
import type { UserId } from '@typist/core'

/**
 * HMAC-signed carrier for the parsed OAuth request across the
 * authorize → main-app consent page → approve round trip. The consent page is
 * on another origin (the main app), so the request travels through the user's
 * browser and must be tamper-proof and short-lived.
 *
 * The state binds the userId it was minted for: /approve rejects a state
 * presented by a different session, so an attacker cannot trick a victim into
 * approving a grant minted under the attacker's session (consent CSRF).
 */

const STATE_TTL_MS = 10 * 60 * 1000

interface StatePayload {
  oauthReq: AuthRequest
  userId: UserId
  expiresAt: number
}

const encoder = new TextEncoder()

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

export async function signOAuthState(
  secret: string,
  oauthReq: AuthRequest,
  userId: UserId,
): Promise<string> {
  const payload: StatePayload = { oauthReq, userId, expiresAt: Date.now() + STATE_TTL_MS }
  const body = encoder.encode(JSON.stringify(payload))
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), body)
  return `${toBase64Url(new Uint8Array(body))}.${toBase64Url(new Uint8Array(signature))}`
}

/** Returns the embedded payload, or null when the state is malformed, tampered, or expired. */
export async function verifyOAuthState(
  secret: string,
  state: string,
): Promise<{ oauthReq: AuthRequest; userId: UserId } | null> {
  const [body, signature] = state.split('.')
  if (!body || !signature) return null
  try {
    const bodyBytes = fromBase64Url(body)
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(signature),
      bodyBytes,
    )
    if (!valid) return null
    const payload: StatePayload = JSON.parse(new TextDecoder().decode(bodyBytes))
    if (payload.expiresAt < Date.now()) return null
    return { oauthReq: payload.oauthReq, userId: payload.userId }
  } catch {
    return null
  }
}

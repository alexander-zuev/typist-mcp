import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env, exports as workerExports } from 'cloudflare:workers'

export const MCP_ORIGIN = 'https://mcp.test'
export const REDIRECT_URI = 'https://client.test/callback'

// `Exports` is untyped without wrangler-generated worker types (env.ts is
// hand-written) — narrow the default export to a fetch handler here.
const worker = workerExports as unknown as {
  default: { fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> }
}

/** Route a request through the worker's default export (the OAuthProvider). */
export async function selfFetch(input: string | Request, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init)
  const ctx = createExecutionContext()
  const response = await worker.default.fetch(request, env, ctx)
  await waitOnExecutionContext(ctx)
  return response
}

export function sessionCookie(userId: string, options?: { anonymous?: boolean }): string {
  return `typist_session=${userId}${options?.anonymous ? '; typist_anon=1' : ''}`
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) }
}

export async function registerClient(metadata?: Record<string, unknown>): Promise<string> {
  const response = await selfFetch(`${MCP_ORIGIN}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [REDIRECT_URI],
      client_name: 'Test Agent',
      token_endpoint_auth_method: 'none',
      ...metadata,
    }),
  })
  if (response.status !== 201) throw new Error(`register failed: ${response.status}`)
  const body: { client_id: string } = await response.json()
  return body.client_id
}

export function authorizeUrl(
  clientId: string,
  challenge: string,
  clientState = 'client-state',
): string {
  const url = new URL('/authorize', MCP_ORIGIN)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('state', clientState)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/** Run authorize → consent state extraction → approve, returning the auth code. */
export async function authorizeAndApprove(
  clientId: string,
  challenge: string,
  cookie: string,
): Promise<string> {
  const authorizeResponse = await selfFetch(authorizeUrl(clientId, challenge), {
    headers: { cookie },
    redirect: 'manual',
  })
  if (authorizeResponse.status !== 302) {
    throw new Error(`authorize did not redirect: ${authorizeResponse.status}`)
  }
  const consentUrl = new URL(authorizeResponse.headers.get('location') ?? '')
  const state = consentUrl.searchParams.get('state')
  if (!state) throw new Error('consent redirect missing state')

  const approveResponse = await selfFetch(`${MCP_ORIGIN}/approve`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ state, decision: 'allow' }),
    redirect: 'manual',
  })
  if (approveResponse.status !== 302) {
    throw new Error(`approve did not redirect: ${approveResponse.status}`)
  }
  const callbackUrl = new URL(approveResponse.headers.get('location') ?? '')
  const code = callbackUrl.searchParams.get('code')
  if (!code) throw new Error(`callback missing code: ${callbackUrl}`)
  return code
}

export async function exchangeCode(
  clientId: string,
  code: string,
  verifier: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  })
  const response = await selfFetch(`${MCP_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (response.status !== 200) throw new Error(`token exchange failed: ${response.status}`)
  const tokenResponse: { access_token: string } = await response.json()
  return tokenResponse.access_token
}

/** Full connect flow for a user: DCR → PKCE authorize/approve → token. */
export async function obtainAccessToken(userId: string): Promise<string> {
  const clientId = await registerClient()
  const { verifier, challenge } = await createPkcePair()
  const code = await authorizeAndApprove(clientId, challenge, sessionCookie(userId))
  return exchangeCode(clientId, code, verifier)
}

/** Expire a real provider-issued access token in test KV. */
export async function expireAccessToken(token: string): Promise<void> {
  const [userId, grantId] = token.split(':')
  if (!userId || !grantId) throw new Error('invalid provider token')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const tokenId = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  const key = `token:${userId}:${grantId}:${tokenId}`
  const stored = await env.OAUTH_KV.get<Record<string, unknown>>(key, 'json')
  if (!stored) throw new Error('provider token record not found')
  await env.OAUTH_KV.put(key, JSON.stringify({ ...stored, expiresAt: 0 }))
}

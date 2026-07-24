import type { ClientInfo } from '@cloudflare/workers-oauth-provider'
import { createLogger, KVClient, unwrapRpc, type McpSession } from '@typist/core'

import type { Env } from './env'
import { signOAuthState, verifyOAuthState } from './signed-state'

const logger = createLogger('mcp-auth-flow')

export const SUPPORTED_SCOPE = 'transcripts:read'

/** One-time-use window for a consent state; mirrors the state's signed TTL. */
const STATE_USED_TTL_SECONDS = 660

/**
 * The provider-external half of the OAuth flow (workers-oauth-provider owns
 * /token, /register, and discovery):
 *
 * GET /authorize — parse the OAuth request, resolve the shared-cookie session
 * via the gateway, then redirect to the main app's consent page with a signed
 * state. No session (or an anonymous one) → main-app sign-in and back.
 *
 * POST /approve — consent form posts back (same-site, cookies flow). Verify
 * state signature + session, require the state's userId to match the session
 * (consent CSRF guard), consume the state (single use, KV-marked), then
 * complete or deny the authorization.
 */
export const authFlowHandler: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/authorize') {
      return handleAuthorize(request, env)
    }
    if (request.method === 'POST' && url.pathname === '/approve') {
      return handleApprove(request, env)
    }
    return new Response('Not found', { status: 404 })
  },
}

async function resolveSession(request: Request, env: Env) {
  const cookieHeader = request.headers.get('cookie')
  if (!cookieHeader) return null
  return unwrapRpc<McpSession | null>(await env.TYPIST_GATEWAY.getSession(cookieHeader))
}

function signInRedirect(env: Env, returnTo: string): Response {
  const signIn = new URL('/sign-in', env.MAIN_APP_URL)
  signIn.searchParams.set('redirect', returnTo)
  return Response.redirect(signIn.toString(), 302)
}

function isWebUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/** Consent page URL on the main app; client metadata URIs are scheme-allowlisted (DCR input is attacker-controlled). */
function consentUrl(env: Env, state: string, client: ClientInfo, clientId: string): string {
  const consent = new URL('/mcp/consent', env.MAIN_APP_URL)
  consent.searchParams.set('state', state)
  consent.searchParams.set('client_name', client.clientName ?? clientId)
  if (isWebUrl(client.logoUri)) consent.searchParams.set('logo_uri', client.logoUri)
  if (isWebUrl(client.clientUri)) consent.searchParams.set('client_uri', client.clientUri)
  consent.searchParams.set('scope', SUPPORTED_SCOPE)
  return consent.toString()
}

async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  let oauthReq
  try {
    oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request)
  } catch (error) {
    logger.info('mcp_authorize_invalid_request', { error })
    return new Response('Invalid authorization request', { status: 400 })
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId)
  if (!client) return new Response('Unknown client', { status: 400 })

  const session = await resolveSession(request, env)
  // Anon gate: anonymous rows are throwaway (deleted on account linking) — a
  // grant tied to one would orphan. Same redirect as no session.
  if (!session || session.isAnonymous) {
    return signInRedirect(env, request.url)
  }

  const state = await signOAuthState(env.MCP_STATE_SECRET, oauthReq, session.userId)
  return Response.redirect(consentUrl(env, state, client, oauthReq.clientId), 302)
}

/** SHA-256 of the state — KV key for single-use consumption without storing the state itself. */
async function stateUsedKey(state: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state))
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `consent-state-used:${hex}`
}

async function handleApprove(request: Request, env: Env): Promise<Response> {
  const form = await request.formData()
  const state = form.get('state')
  const decision = form.get('decision')
  if (typeof state !== 'string' || (decision !== 'allow' && decision !== 'deny')) {
    return new Response('Invalid consent submission', { status: 400 })
  }

  const verified = await verifyOAuthState(env.MCP_STATE_SECRET, state)
  if (!verified) {
    return new Response('Consent request expired - start over from your client', { status: 400 })
  }

  const session = await resolveSession(request, env)
  if (!session || session.isAnonymous) {
    // The session died between consent render and submit. A bare redirect back
    // to this POST URL would land as a GET → 404, so resume at the consent
    // page (the state is still valid and unused).
    const client = await env.OAUTH_PROVIDER.lookupClient(verified.oauthReq.clientId)
    if (!client) return new Response('Unknown client', { status: 400 })
    return signInRedirect(env, consentUrl(env, state, client, verified.oauthReq.clientId))
  }
  if (session.userId !== verified.userId) {
    logger.warn('mcp_consent_user_mismatch', { userId: session.userId })
    return new Response('Consent request was started by a different user - start over', {
      status: 403,
    })
  }

  // Single use: mark consumed before completing. The small get→put race is
  // acceptable; the guard exists to stop replay of a captured state.
  const kv = new KVClient(env.OAUTH_KV)
  const usedKey = await stateUsedKey(state)
  if (await kv.get(usedKey)) {
    return new Response('Consent request already used - start over from your client', {
      status: 400,
    })
  }
  await kv.put(usedKey, '1', { ttl: STATE_USED_TTL_SECONDS })

  if (decision === 'deny') {
    const denied = new URL(verified.oauthReq.redirectUri)
    denied.searchParams.set('error', 'access_denied')
    if (verified.oauthReq.state) denied.searchParams.set('state', verified.oauthReq.state)
    logger.info('mcp_consent_denied', { userId: session.userId })
    return Response.redirect(denied.toString(), 302)
  }

  // grantId keys per-grant rate limits and telemetry; minted here because the
  // provider does not expose its internal grant id.
  const grantId = crypto.randomUUID()
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: verified.oauthReq,
    userId: session.userId,
    metadata: { grantId },
    scope: [SUPPORTED_SCOPE],
    props: { userId: session.userId, grantId, scopes: [SUPPORTED_SCOPE] },
  })
  logger.info('mcp_consent_allowed', { userId: session.userId, grantId })
  return Response.redirect(redirectTo, 302)
}

import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { createLogger, InternalServerError } from '@typist/core'

import { fingerprintOAuthState } from '../infrastructure/auth/oauth-state-replay-store'
import { signOAuthState, verifyOAuthState } from '../infrastructure/auth/signed-state'
import { createMcpServerDeps, type McpServerDeps } from '../infrastructure/mcp-server-deps'
import { consentUrl, signInRedirect } from '../presentation/auth-urls'

const logger = createLogger('mcp-auth-flow')

interface OAuthHandlerEnv extends McpEnv {
  OAUTH_PROVIDER: OAuthHelpers
}

/** workers-oauth-provider injects its helpers only before invoking the default handler. */
function hasOAuthProviderHelpers(env: McpEnv): env is OAuthHandlerEnv {
  return 'OAUTH_PROVIDER' in env
}

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
export const authFlowHandler: ExportedHandler<McpEnv> = {
  async fetch(request, env, ctx): Promise<Response> {
    if (!hasOAuthProviderHelpers(env)) {
      throw new InternalServerError('OAuth provider helpers unavailable', false)
    }

    const deps = createMcpServerDeps(env, ctx)
    const oauth = env.OAUTH_PROVIDER

    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/authorize') {
      return handleAuthorize(request, deps, oauth)
    }
    if (request.method === 'POST' && url.pathname === '/approve') {
      return handleApprove(request, deps, oauth)
    }
    // log the request/warn/erorr - since it's not expected?
    return new Response('Not found', { status: 404 })
  },
}

async function resolveSession(request: Request, deps: McpServerDeps) {
  const cookieHeader = request.headers.get('cookie')
  if (!cookieHeader) return null
  return deps.clients.gateway.getSession(cookieHeader)
}

async function handleAuthorize(
  request: Request,
  deps: McpServerDeps,
  oauth: OAuthHelpers,
): Promise<Response> {
  let oauthReq
  try {
    oauthReq = await oauth.parseAuthRequest(request)
  } catch (error) {
    logger.info('mcp_authorize_invalid_request', { error })
    return new Response('Invalid authorization request', { status: 400 })
  }

  const client = await oauth.lookupClient(oauthReq.clientId)
  if (!client) return new Response('Unknown client', { status: 400 })

  const session = await resolveSession(request, deps)
  // Anon gate: anonymous rows are throwaway (deleted on account linking) — a
  // grant tied to one would orphan. Same redirect as no session.
  if (!session || session.isAnonymous) {
    return signInRedirect(deps.env.MAIN_APP_URL, request.url)
  }

  const state = await signOAuthState(deps.env.MCP_STATE_SECRET, oauthReq, session.userId)
  return Response.redirect(
    consentUrl(deps.env.MAIN_APP_URL, state, client, oauthReq.clientId),
    302,
  )
}

async function handleApprove(
  request: Request,
  deps: McpServerDeps,
  oauth: OAuthHelpers,
): Promise<Response> {
  const form = await request.formData()
  const state = form.get('state')
  const decision = form.get('decision')
  if (typeof state !== 'string' || (decision !== 'allow' && decision !== 'deny')) {
    return new Response('Invalid consent submission', { status: 400 })
  }

  const verified = await verifyOAuthState(deps.env.MCP_STATE_SECRET, state)
  if (!verified) {
    return new Response('Consent request expired - start over from your client', { status: 400 })
  }

  const session = await resolveSession(request, deps)
  if (!session || session.isAnonymous) {
    // The session died between consent render and submit. A bare redirect back
    // to this POST URL would land as a GET → 404, so resume at the consent
    // page (the state is still valid and unused).
    const client = await oauth.lookupClient(verified.oauthReq.clientId)
    if (!client) return new Response('Unknown client', { status: 400 })
    return signInRedirect(
      deps.env.MAIN_APP_URL,
      consentUrl(deps.env.MAIN_APP_URL, state, client, verified.oauthReq.clientId),
    )
  }
  if (session.userId !== verified.userId) {
    logger.warn('mcp_consent_user_mismatch', { userId: session.userId })
    return new Response('Consent request was started by a different user - start over', {
      status: 403,
    })
  }

  const stateId = await fingerprintOAuthState(state)
  const logContext = {
    stateId,
    userId: session.userId,
    clientId: verified.oauthReq.clientId,
  }
  logger.info('mcp_consent_decision_received', { ...logContext, decision })

  // Single use: mark consumed before completing. The small get→put race is
  // acceptable; the guard exists to stop replay of a captured state.
  if (await deps.stores.oauthStateReplay.wasUsed(state)) {
    logger.warn('mcp_consent_replay_rejected', logContext)
    return new Response('Consent request already used - start over from your client', {
      status: 400,
    })
  }
  await deps.stores.oauthStateReplay.markUsed(state)

  if (decision === 'deny') {
    const denied = new URL(verified.oauthReq.redirectUri)
    denied.searchParams.set('error', 'access_denied')
    if (verified.oauthReq.state) denied.searchParams.set('state', verified.oauthReq.state)
    logger.info('mcp_consent_denied', logContext)
    return Response.redirect(denied.toString(), 302)
  }

  const { redirectTo } = await oauth.completeAuthorization({
    request: verified.oauthReq,
    userId: session.userId,
    metadata: {},
    scope: [],
    props: { userId: session.userId },
  })
  logger.info('mcp_consent_allowed', logContext)
  return Response.redirect(redirectTo, 302)
}

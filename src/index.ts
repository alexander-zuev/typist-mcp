import OAuthProvider from '@cloudflare/workers-oauth-provider'
import * as Sentry from '@sentry/cloudflare'
import { runWithAnalyticsContext, setLoggerErrorHook, UUIDSchema } from '@typist/core'

import { authFlowHandler } from './entrypoints/auth-handlers'
import { TypistMcp } from './entrypoints/mcp-server'
import { createUserBoundMcpHandler } from './infrastructure/auth/user-bound-mcp-handler'
import { createMcpServerSentryOptions } from './infrastructure/observability/sentry'

export { TypistMcp }

setLoggerErrorHook((entry) => {
  Sentry.captureException(entry.error, {
    extra: entry.context,
    ...(entry.distinctId && { user: { id: entry.distinctId } }),
  })
})

/**
 * typist-mcp IS the OAuth authorization server (spec D1): the provider owns
 * /token, /register, and discovery metadata; /authorize + /approve live in the
 * default handler and lean on the main app for session + consent UI.
 */
const oauthProvider = new OAuthProvider<McpEnv>({
  // Streamable HTTP only — v1 has no legacy SSE surface.
  apiHandlers: {
    '/mcp': createUserBoundMcpHandler(TypistMcp.serve('/mcp')),
  },
  defaultHandler: authFlowHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  allowPlainPKCE: false,
})

export default Sentry.withSentry(createMcpServerSentryOptions, {
  fetch(request, env, ctx) {
    return runWithAnalyticsContext(
      { idempotencyKey: { uuid: UUIDSchema.parse(crypto.randomUUID()) } },
      () => oauthProvider.fetch(request, env, ctx),
    )
  },
}) satisfies ExportedHandler<McpEnv>

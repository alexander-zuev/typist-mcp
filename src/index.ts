import OAuthProvider from '@cloudflare/workers-oauth-provider'
import { TypistMcp } from './agent'
import { authFlowHandler, SUPPORTED_SCOPE } from './auth-flow'

export { TypistMcp }

/**
 * typist-mcp IS the OAuth authorization server (spec D1): the provider owns
 * /token, /register, and discovery metadata; /authorize + /approve live in the
 * default handler and lean on the main app for session + consent UI.
 */
export default new OAuthProvider({
  // Streamable HTTP only — v1 has no legacy SSE surface.
  apiHandlers: {
    '/mcp': TypistMcp.serve('/mcp'),
  },
  defaultHandler: authFlowHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  scopesSupported: [SUPPORTED_SCOPE],
  allowPlainPKCE: false,
})

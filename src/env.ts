import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import type { McpGatewayContract } from '@typist/core'

/**
 * Hand-written Env: `wrangler types` cannot type the RPC service binding
 * against `McpGatewayContract` (the entrypoint lives in the private monorepo),
 * so the binding is typed here as Fetcher + the frozen contract.
 */
export interface Env {
  ENV: 'development' | 'production'
  /** Origin of the main app — sign-in + consent pages live there. */
  MAIN_APP_URL: string
  /** HMAC key for the authorize→consent→approve state round trip. */
  MCP_STATE_SECRET: string
  OAUTH_KV: KVNamespace
  /** Injected by workers-oauth-provider into the default handler. */
  OAUTH_PROVIDER: OAuthHelpers
  TYPIST_GATEWAY: Fetcher & McpGatewayContract
  MCP_OBJECT: DurableObjectNamespace
  /** Main worker's RateLimiterDO, bound cross-script (`script_name`). */
  RATE_LIMITER: DurableObjectNamespace
}

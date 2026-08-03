import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as Sentry from '@sentry/cloudflare'
import { AuthenticationError, type McpClientIdentity, type UserId } from '@typist/core'
import { McpAgent } from 'agents/mcp'

import packageJson from '../../package.json' with { type: 'json' }
import { instrumentMcpAnalytics } from '../infrastructure/analytics/mcp-analytics'
import type { McpTokenProps } from '../infrastructure/auth/mcp-token-props'
import { createMcpServerDeps, type McpServerDeps } from '../infrastructure/mcp-server-deps'
import { createMcpServerDurableObjectSentryOptions } from '../infrastructure/observability/sentry'
import { registerTranscriptTools } from './tools/transcript-tools'

class TypistMcpBase extends McpAgent<McpEnv, unknown, McpTokenProps> {
  server = new McpServer({
    name: packageJson.name,
    title: 'Typist',
    version: packageJson.version,
  })
  private readonly deps: McpServerDeps

  constructor(ctx: DurableObjectState, env: McpEnv) {
    super(ctx, env)
    this.deps = createMcpServerDeps(env, ctx)
  }

  async init() {
    const userId = this.userId()
    const client = this.clientIdentity()
    instrumentMcpAnalytics(this.server, this.deps.services.analytics, userId, client)
    registerTranscriptTools({
      server: this.server,
      gateway: this.deps.clients.gateway,
      rateLimiter: this.deps.dos.rateLimiter,
      userId,
    })
  }

  /** OAuth registration identity, absent on grants issued before it was recorded. */
  private clientIdentity(): McpClientIdentity {
    return { client_id: this.props?.clientId, client_name: this.props?.clientName }
  }

  private userId(): UserId {
    // Props are decrypted from the bearer token; absence means the token was
    // minted without completeAuthorization — never legitimate.
    const userId = this.props?.userId
    if (!userId) throw new AuthenticationError('Missing userId in OAuth token')
    return userId
  }
}

export const TypistMcp = Sentry.instrumentDurableObjectWithSentry(
  createMcpServerDurableObjectSentryOptions,
  TypistMcpBase,
)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as Sentry from '@sentry/cloudflare'
import {
  AuthenticationError,
  createLogger,
  type McpClientIdentity,
  mcpConnectionInitialized,
  runWithAnalyticsContext,
  UUIDSchema,
  type UserId,
} from '@typist/core'
import { McpAgent } from 'agents/mcp'

import packageJson from '../../package.json' with { type: 'json' }
import type { McpTokenProps } from '../infrastructure/auth/mcp-token-props'
import { createMcpServerDeps, type McpServerDeps } from '../infrastructure/mcp-server-deps'
import { createMcpServerDurableObjectSentryOptions } from '../infrastructure/observability/sentry'
import { registerTranscriptTools } from './tools/transcript-tools'

const logger = createLogger('typist-mcp')

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

  fetch(request: Request): Promise<Response> {
    return runWithAnalyticsContext(
      { idempotencyKey: { uuid: UUIDSchema.parse(crypto.randomUUID()) } },
      () => super.fetch(request),
    )
  }

  async init() {
    const userId = this.userId()
    const client = this.clientIdentity()
    registerTranscriptTools({
      analytics: this.deps.services.analytics,
      server: this.server,
      gateway: this.deps.clients.gateway,
      rateLimiter: this.deps.dos.rateLimiter,
      userId,
      client,
    })
    this.server.server.oninitialized = () => {
      const handshake = this.server.server.getClientVersion()
      if (!handshake) {
        logger.warn('mcp_initialize_request_unavailable', { userId })
        return
      }

      this.deps.services.analytics.track(
        mcpConnectionInitialized({ ...client, mcp_client_name: handshake.name }),
        userId,
      )
    }
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

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { instrument } from '@posthog/mcp'
import { createLogger, type McpClientIdentity, type UserId } from '@typist/core'
import type { PostHogAnalyticsService } from '@typist/core/analytics'

const logger = createLogger('mcp-analytics')

/** Adds canonical PostHog MCP events to the existing PostHog client. */
export function instrumentMcpAnalytics(
  server: McpServer,
  analytics: PostHogAnalyticsService,
  userId: UserId,
  client: McpClientIdentity,
): void {
  const clientProperties = {
    ...(client.client_id && { client_id: client.client_id }),
    ...(client.client_name && { client_name: client.client_name }),
  }

  instrument(server, analytics.posthog, {
    context: false,
    reportMissing: false,
    enableConversationId: false,
    enableExceptionAutocapture: false,
    identify: { distinctId: userId },
    eventProperties: () => clientProperties,
    logger: (message) => logger.warn('posthog_mcp_warning', { message, userId }),
  })
}

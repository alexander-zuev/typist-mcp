import { PostHogAnalyticsService } from '@typist/core'

import type { McpServerExecutionContext } from '../mcp-server-deps'

/** Configures the shared PostHog transport for the MCP Worker. */
export function createAnalyticsService(
  env: McpEnv,
  executionCtx: McpServerExecutionContext,
): PostHogAnalyticsService {
  const runtime = {
    environment: env.ENV,
    source: 'typist-mcp',
    waitUntil: (promise: Promise<unknown>) => executionCtx.waitUntil(promise),
  }

  if (env.ENV === 'development') {
    return PostHogAnalyticsService.create({ ...runtime, enabled: false })
  }

  return PostHogAnalyticsService.create({
    ...runtime,
    apiKey: env.POSTHOG_API_KEY,
    enabled: true,
  })
}

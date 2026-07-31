import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  AuthenticationError,
  BillingError,
  CaptchaError,
  createLogger,
  EntityNotFoundError,
  type McpClientIdentity,
  mcpToolCalled,
  type McpToolErrorCode,
  type PostHogAnalyticsService,
  RateLimitError,
  ValidationError,
  type RateLimiterClient,
  type UserId,
} from '@typist/core'

import { TOOL_RATE_LIMITS, type ToolName } from './tool-policy'
import { toolError } from './tool-result'

const logger = createLogger('typist-mcp')

interface ToolExecutionContext {
  analytics: PostHogAnalyticsService
  rateLimiter: Pick<RateLimiterClient, 'check'>
  userId: UserId
  client: McpClientIdentity
}

interface ExpectedToolError {
  code: McpToolErrorCode
  message: string
}

function expectedToolError(error: unknown): ExpectedToolError | null {
  if (error instanceof ValidationError || error instanceof CaptchaError) {
    return { code: 'invalid_input', message: error.message }
  }
  if (error instanceof AuthenticationError) {
    return { code: 'unauthenticated', message: error.message }
  }
  if (error instanceof EntityNotFoundError) {
    return { code: 'not_found', message: error.message }
  }
  if (error instanceof BillingError) {
    return { code: 'billing_blocked', message: error.message }
  }
  if (error instanceof RateLimitError) {
    return { code: 'rate_limited', message: error.message }
  }
  return null
}

export async function executeTool(
  context: ToolExecutionContext,
  tool: ToolName,
  execute: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    const limit = TOOL_RATE_LIMITS[tool]
    const { allowed, retryAfter } = await context.rateLimiter.check(
      `mcp:${tool}:${context.userId}`,
      limit.max,
      limit.windowMs,
    )
    if (!allowed) {
      logger.info('mcp_tool_rate_limited', { tool, userId: context.userId })
      context.analytics.track(
        mcpToolCalled({ ...context.client, tool, outcome: 'error', error_code: 'rate_limited' }),
        context.userId,
      )
      return toolError(`Rate limit exceeded. Retry in ${retryAfter} seconds.`)
    }

    const result = await execute()
    context.analytics.track(
      mcpToolCalled({ ...context.client, tool, outcome: 'success' }),
      context.userId,
    )
    return result
  } catch (error) {
    const expected = expectedToolError(error)
    const errorCode = expected?.code ?? 'internal_error'
    if (!expected) logger.error('mcp_tool_failed', { tool, userId: context.userId, error })
    context.analytics.track(
      mcpToolCalled({ ...context.client, tool, outcome: 'error', error_code: errorCode }),
      context.userId,
    )
    return toolError(expected?.message ?? 'Something went wrong')
  }
}

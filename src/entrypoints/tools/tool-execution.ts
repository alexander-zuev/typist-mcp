import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  AuthenticationError,
  BillingError,
  CaptchaError,
  createLogger,
  EntityNotFoundError,
  RateLimitError,
  ValidationError,
  type RateLimiterClient,
  type UserId,
} from '@typist/core'

import { TOOL_RATE_LIMITS, type ToolName } from './tool-policy'
import { toolError } from './tool-result'

const logger = createLogger('typist-mcp')

interface ToolExecutionContext {
  rateLimiter: Pick<RateLimiterClient, 'check'>
  userId: UserId
}

interface ExpectedToolError {
  message: string
}

function expectedToolError(error: unknown): ExpectedToolError | null {
  if (error instanceof ValidationError || error instanceof CaptchaError) {
    return { message: error.message }
  }
  if (error instanceof AuthenticationError) {
    return { message: error.message }
  }
  if (error instanceof EntityNotFoundError) {
    return { message: error.message }
  }
  if (error instanceof BillingError) {
    return { message: error.message }
  }
  if (error instanceof RateLimitError) {
    return { message: error.message }
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
      return toolError(`Rate limit exceeded. Retry in ${retryAfter} seconds.`)
    }

    return await execute()
  } catch (error) {
    const expected = expectedToolError(error)
    if (!expected) logger.error('mcp_tool_failed', { tool, userId: context.userId, error })
    return toolError(expected?.message ?? 'Something went wrong')
  }
}

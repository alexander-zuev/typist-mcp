import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createLogger, type RateLimiterClient, type UserId } from '@typist/core'

import { TOOL_RATE_LIMITS, type ToolName } from './tool-policy'
import { toolError } from './tool-result'

const logger = createLogger('typist-mcp')

interface ToolExecutionContext {
  rateLimiter: Pick<RateLimiterClient, 'check'>
  userId: UserId
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
    logger.error('mcp_tool_failed', { tool, userId: context.userId, error })
    return toolError('Something went wrong')
  }
}

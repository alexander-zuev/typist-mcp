import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  AuthenticationError,
  BillingError,
  CaptchaError,
  createLogger,
  EntityNotFoundError,
  RateLimitError,
  ValidationError,
  type BurstLimiter,
  type UserId,
} from '@typist/core'

import { type ToolName } from './tool-policy'
import { toolError } from './tool-result'

const logger = createLogger('typist-mcp')

interface ToolExecutionContext {
  burst: BurstLimiter
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
    const allowed = await context.burst.consume(`mcp:${tool}:${context.userId}`)
    if (!allowed) {
      logger.info('mcp_tool_rate_limited', { tool, userId: context.userId })
      return toolError('Rate limit exceeded. Retry in 60 seconds.')
    }

    return await execute()
  } catch (error) {
    const expected = expectedToolError(error)
    if (!expected)
      logger.error('mcp_tool_failed', { error, userId: context.userId, details: { tool } })
    return toolError(expected?.message ?? 'Something went wrong')
  }
}

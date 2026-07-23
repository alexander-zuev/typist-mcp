import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  createLogger,
  getTranscriptInputSchema,
  getTranscriptResultSchema,
  searchTranscriptsInputSchema,
  searchTranscriptsResultSchema,
  type UserId,
} from '@typist/core'
import { McpAgent } from 'agents/mcp'
import type { Env } from './env'
import { GrantRateLimiter } from './rate-limit'
import { renderSearchResult, renderTranscriptResult } from './render'

const logger = createLogger('typist-mcp')

/** Set by workers-oauth-provider at completeAuthorization; decrypted from the bearer token. */
interface Props extends Record<string, unknown> {
  userId: UserId
}

const RATE_LIMITS = {
  search_transcripts: { max: 60, windowMs: 60_000 },
  get_transcript: { max: 30, windowMs: 60_000 },
} as const

type ToolName = keyof typeof RATE_LIMITS

interface ToolText {
  [x: string]: unknown
  content: Array<{ [x: string]: unknown; type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

function toolError(text: string): ToolText {
  return { content: [{ type: 'text', text }], isError: true }
}

export class TypistMcp extends McpAgent<Env, unknown, Props> {
  server = new McpServer({ name: 'typist', version: '1.0.0' })

  async init() {
    this.server.registerTool(
      'search_transcripts',
      {
        title: 'Search transcripts',
        description:
          'Search your Typist transcript library by title/topic, category, or date range. ' +
          'Empty query lists most recent first. Only completed transcripts are returned; ' +
          'locked ones appear with locked=true and get_transcript serves their preview.',
        inputSchema: searchTranscriptsInputSchema.shape,
        outputSchema: searchTranscriptsResultSchema.shape,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input) =>
        this.runTool('search_transcripts', async () => {
          const parsed = searchTranscriptsInputSchema.parse(input)
          const result = await this.env.TYPIST_GATEWAY.searchTranscripts(this.userId(), parsed)
          return {
            content: [{ type: 'text' as const, text: renderSearchResult(result) }],
            structuredContent: result,
          }
        }),
    )

    this.server.registerTool(
      'get_transcript',
      {
        title: 'Get transcript',
        description:
          'Fetch transcript content by id. Chunked: pass offset from the previous ' +
          "response's nextOffset to continue; raise maxChars (up to 90000) on clients " +
          'without small output caps. format txt|srt|vtt; delivery "url" returns a ' +
          '1-hour download link instead of inline text.',
        // The result is a discriminated union (inline | url) which cannot be a raw
        // object shape — wrapped in { result } for outputSchema/structuredContent.
        inputSchema: getTranscriptInputSchema.shape,
        outputSchema: { result: getTranscriptResultSchema },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input) =>
        this.runTool('get_transcript', async () => {
          const parsed = getTranscriptInputSchema.parse(input)
          const result = await this.env.TYPIST_GATEWAY.getTranscriptChunk(this.userId(), parsed)
          if (result.kind === 'not_found') return toolError('Transcript not found')
          return {
            content: [{ type: 'text' as const, text: renderTranscriptResult(result) }],
            structuredContent: { result },
          }
        }),
    )
  }

  private userId(): UserId {
    // Props are decrypted from the bearer token; absence means the token was
    // minted without completeAuthorization — never legitimate.
    const userId = this.props?.userId
    if (!userId) throw new Error('Missing userId in auth props')
    return userId
  }

  /** Rate limit → execute → map errors → single structured log per call (never transcript text). */
  private async runTool(tool: ToolName, execute: () => Promise<ToolText>): Promise<ToolText> {
    const startedAt = Date.now()
    const limit = RATE_LIMITS[tool]
    const limiter = new GrantRateLimiter(this.env.RATE_LIMITER)
    const { allowed, retryAfter } = await limiter.check(
      `mcp:${tool}:${this.userId()}`,
      limit.max,
      limit.windowMs,
    )
    if (!allowed) {
      logger.info('mcp_tool_called', { tool, status: 'rate_limited', userId: this.userId() })
      return toolError(
        `Rate limit exceeded. Retry in ${retryAfter ?? 60} seconds.`,
      )
    }

    try {
      const result = await execute()
      logger.info('mcp_tool_called', {
        tool,
        status: 'ok',
        latencyMs: Date.now() - startedAt,
        userId: this.userId(),
      })
      return result
    } catch (error) {
      // Expected outcomes (not-found) are contract variants, never thrown —
      // anything landing here is unexpected and must not leak details.
      logger.error('mcp_tool_called', {
        tool,
        status: 'error',
        latencyMs: Date.now() - startedAt,
        userId: this.userId(),
        error,
      })
      return toolError('Something went wrong')
    }
  }
}

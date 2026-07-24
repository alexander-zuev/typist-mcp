import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  createLogger,
  downloadTranscriptContentSchema,
  downloadTranscriptInputSchema,
  readTranscriptContentSchema,
  readTranscriptInputSchema,
  searchTranscriptsInputSchema,
  transcriptsPageSchema,
  unwrapRpc,
  type DownloadTranscriptResult,
  type ReadTranscriptResult,
  type TranscriptsPage,
  type UserId,
} from '@typist/core'
import { McpAgent } from 'agents/mcp'

import { SUPPORTED_SCOPE } from './auth-flow'
import type { Env } from './env'
import { GrantRateLimiter } from './rate-limit'
import { renderDownloadResult, renderReadResult, renderTranscriptsPage } from './render'

const logger = createLogger('typist-mcp')

/** Set by workers-oauth-provider at completeAuthorization; decrypted from the bearer token. */
interface Props extends Record<string, unknown> {
  userId: UserId
  grantId: string
  scopes: string[]
}

/**
 * Public tool output: the transcript body lives ONLY in the text content block
 * (structured duplication would double the response against client output
 * caps), and the RPC-transport `not_found` variant is converted to `isError`
 * before it can reach this schema.
 */
const readTranscriptToolResultSchema = readTranscriptContentSchema.omit({ text: true })

const RATE_LIMITS = {
  search_transcripts: { max: 60, windowMs: 60_000 },
  read_transcript: { max: 30, windowMs: 60_000 },
  download_transcript: { max: 30, windowMs: 60_000 },
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

function isRpcError(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  )
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
          'Omit query to list recent transcripts. Only completed transcripts are returned; ' +
          'locked ones appear with locked=true and read_transcript serves their preview.',
        inputSchema: searchTranscriptsInputSchema.shape,
        outputSchema: transcriptsPageSchema.shape,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input) =>
        this.runTool('search_transcripts', async () => {
          const parsed = searchTranscriptsInputSchema.parse(input)
          const result = unwrapRpc<TranscriptsPage>(
            await this.env.TYPIST_GATEWAY.searchTranscripts(this.userId(), parsed),
          )
          return {
            content: [{ type: 'text' as const, text: renderTranscriptsPage(result) }],
            structuredContent: result,
          }
        }),
    )

    this.server.registerTool(
      'read_transcript',
      {
        title: 'Read transcript',
        description:
          'Read transcript content by id. The transcript text is in the text content ' +
          "block; structured content carries pagination metadata. Pass the previous response's " +
          'nextOffset as offset to continue; raise maxChars (up to 90000) on clients ' +
          'without small output caps. Supports txt, srt, and vtt.',
        inputSchema: readTranscriptInputSchema.shape,
        outputSchema: { result: readTranscriptToolResultSchema },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input) =>
        this.runTool('read_transcript', async () => {
          const parsed = readTranscriptInputSchema.parse(input)
          const result = unwrapRpc<ReadTranscriptResult>(
            await this.env.TYPIST_GATEWAY.readTranscript(this.userId(), parsed),
          )
          if (result.kind === 'not_found') return toolError('Transcript not found')
          const { text: _body, ...structured } = result
          return {
            content: [{ type: 'text' as const, text: renderReadResult(result) }],
            structuredContent: { result: structured },
          }
        }),
    )

    this.server.registerTool(
      'download_transcript',
      {
        title: 'Download transcript',
        description: 'Create a one-hour download URL for a transcript in txt, srt, or vtt format.',
        inputSchema: downloadTranscriptInputSchema.shape,
        outputSchema: { result: downloadTranscriptContentSchema },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input) =>
        this.runTool('download_transcript', async () => {
          const parsed = downloadTranscriptInputSchema.parse(input)
          const result = unwrapRpc<DownloadTranscriptResult>(
            await this.env.TYPIST_GATEWAY.downloadTranscript(this.userId(), parsed),
          )
          if (result.kind === 'not_found') return toolError('Transcript not found')
          return {
            content: [{ type: 'text' as const, text: renderDownloadResult(result) }],
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

  /** Scope gate → rate limit → execute → single structured log per call (never transcript text). */
  private async runTool(tool: ToolName, execute: () => Promise<ToolText>): Promise<ToolText> {
    const startedAt = Date.now()
    const grantId = this.props?.grantId ?? 'unknown'
    const log = (status: string, extra?: Record<string, unknown>) =>
      logger[status === 'error' ? 'error' : 'info']('mcp_tool_called', {
        tool,
        status,
        latencyMs: Date.now() - startedAt,
        userId: this.userId(),
        grantId,
        ...extra,
      })

    // Today every minted token carries the scope; this guards future scopes
    // and tokens that predate a scope change.
    if (!this.props?.scopes?.includes(SUPPORTED_SCOPE)) {
      log('forbidden')
      return toolError(`Missing required scope: ${SUPPORTED_SCOPE}`)
    }

    const limit = RATE_LIMITS[tool]
    const limiter = new GrantRateLimiter(this.env.RATE_LIMITER)
    // Keyed per grant (one client cannot exhaust the user's other grants);
    // userId included for operational readability of limiter keys.
    const { allowed, retryAfter } = await limiter.check(
      `mcp:${tool}:${this.userId()}:${grantId}`,
      limit.max,
      limit.windowMs,
    )
    if (!allowed) {
      log('rate_limited')
      return toolError(`Rate limit exceeded. Retry in ${retryAfter ?? 60} seconds.`)
    }

    try {
      const result = await execute()
      const chars = result.content.reduce((total, block) => total + block.text.length, 0)
      log(result.isError ? 'tool_error' : 'ok', { chars })
      return result
    } catch (error) {
      if (isRpcError(error)) {
        log('tool_error', { errorCode: error.code })
        return toolError(error.message)
      }
      log('error', { error })
      return toolError('Something went wrong')
    }
  }
}

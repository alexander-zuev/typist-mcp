import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  downloadTranscriptInputSchema,
  EntityNotFoundError,
  type McpClientIdentity,
  mcpExportTranscriptionResponseSchema,
  type PostHogAnalyticsService,
  type RateLimiterClient,
  readTranscriptInputSchema,
  searchTranscriptsInputSchema,
  transcriptsPageSchema,
  type UserId,
} from '@typist/core'

import type { McpGatewayClient } from '../../infrastructure/clients/mcp-gateway-client'
import {
  renderDownloadResult,
  renderReadResult,
  renderTranscriptsPage,
} from '../../presentation/tool-result-renderers'
import { executeTool } from './tool-execution'
import { toolSuccess, toolText } from './tool-result'

interface TranscriptToolContext {
  analytics: PostHogAnalyticsService
  server: McpServer
  gateway: McpGatewayClient
  rateLimiter: Pick<RateLimiterClient, 'check'>
  userId: UserId
  client: McpClientIdentity
}

/** Registers the complete read-only transcript tool surface. */
export function registerTranscriptTools(context: TranscriptToolContext): void {
  const { analytics, server, gateway, rateLimiter, userId, client } = context
  const executionContext = { analytics, rateLimiter, userId, client }

  server.registerTool(
    'search_transcripts',
    {
      title: 'Search transcripts',
      description:
        'Search your Typist transcript library by title/topic, category, or date range. ' +
        'Omit query to list recent transcripts. Only completed transcripts are returned; ' +
        'locked ones appear with locked=true and read_transcript serves their preview.',
      inputSchema: searchTranscriptsInputSchema,
      outputSchema: transcriptsPageSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      executeTool(executionContext, 'search_transcripts', async () => {
        const result = await gateway.searchTranscripts(userId, input)
        return toolSuccess(renderTranscriptsPage(result), result)
      }),
  )

  server.registerTool(
    'read_transcript',
    {
      title: 'Read transcript',
      description:
        'Read transcript content by id. Returns YAML front matter (title, offset, chars, ' +
        'totalChars, truncated, nextOffset when more remains, locked) followed by the ' +
        'transcript text. Pass nextOffset as offset to continue; raise maxChars (up to ' +
        '90000) on clients without small output caps. includeSegments weaves [m:ss] ' +
        'timestamps into txt so you can cite when something was said; keep it stable ' +
        'while paging, as it changes offsets. Supports txt, srt, and vtt.',
      inputSchema: readTranscriptInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      executeTool(executionContext, 'read_transcript', async () => {
        const result = await gateway.readTranscript(userId, input)
        if (result.kind === 'not_found') {
          throw new EntityNotFoundError('Transcript not found')
        }
        // No outputSchema, so no structuredContent: the transcript is an opaque blob with
        // nothing for a caller to filter or branch on, and a client that renders the
        // structured block and drops the text block would otherwise receive no transcript.
        return toolText(renderReadResult(result))
      }),
  )

  server.registerTool(
    'download_transcript',
    {
      title: 'Download transcript',
      description: 'Create a one-hour download URL for a transcript in txt, srt, or vtt format.',
      inputSchema: downloadTranscriptInputSchema,
      outputSchema: { result: mcpExportTranscriptionResponseSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      executeTool(executionContext, 'download_transcript', async () => {
        const result = await gateway.downloadTranscript(userId, input)
        return toolSuccess(renderDownloadResult(result), { result })
      }),
  )
}

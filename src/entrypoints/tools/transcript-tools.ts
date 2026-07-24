import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  downloadTranscriptInputSchema,
  EntityNotFoundError,
  mcpExportTranscriptionResponseSchema,
  type RateLimiterClient,
  readTranscriptContentSchema,
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
import { toolError, toolSuccess } from './tool-result'

const readTranscriptToolResultSchema = readTranscriptContentSchema.omit({ text: true })

interface TranscriptToolContext {
  server: McpServer
  gateway: McpGatewayClient
  rateLimiter: Pick<RateLimiterClient, 'check'>
  userId: UserId
}

/** Registers the complete read-only transcript tool surface. */
export function registerTranscriptTools(context: TranscriptToolContext): void {
  const { server, gateway, rateLimiter, userId } = context
  const executionContext = { rateLimiter, userId }

  server.registerTool(
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
      executeTool(executionContext, 'search_transcripts', async () => {
        const result = await gateway.searchTranscripts(
          userId,
          searchTranscriptsInputSchema.parse(input),
        )
        return toolSuccess(renderTranscriptsPage(result), result)
      }),
  )

  server.registerTool(
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
      executeTool(executionContext, 'read_transcript', async () => {
        const result = await gateway.readTranscript(userId, readTranscriptInputSchema.parse(input))
        if (result.kind === 'not_found') return toolError('Transcript not found')
        const { text: _body, ...structured } = result
        return toolSuccess(renderReadResult(result), { result: structured })
      }),
  )

  server.registerTool(
    'download_transcript',
    {
      title: 'Download transcript',
      description: 'Create a one-hour download URL for a transcript in txt, srt, or vtt format.',
      inputSchema: downloadTranscriptInputSchema.shape,
      outputSchema: { result: mcpExportTranscriptionResponseSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      executeTool(executionContext, 'download_transcript', async () => {
        try {
          const result = await gateway.downloadTranscript(
            userId,
            downloadTranscriptInputSchema.parse(input),
          )
          return toolSuccess(renderDownloadResult(result), { result })
        } catch (error) {
          if (error instanceof EntityNotFoundError) return toolError('Transcript not found')
          throw error
        }
      }),
  )
}

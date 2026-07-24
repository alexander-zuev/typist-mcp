import {
  unwrapResult,
  type DownloadTranscriptInput,
  type ExportTranscriptionResponse,
  type McpGatewayContract,
  type McpSession,
  type ReadTranscriptInput,
  type ReadTranscriptResult,
  type SearchTranscriptsInput,
  type TranscriptsPage,
  type UserId,
} from '@typist/core'

/** Typed server-to-server client for the main app's MCP gateway entrypoint. */
export class McpGatewayClient {
  constructor(private readonly gateway: McpGatewayContract) {}

  getSession(cookieHeader: string): Promise<McpSession | null> {
    return unwrapResult<McpSession | null>(this.gateway.getSession(cookieHeader))
  }

  searchTranscripts(
    userId: UserId,
    input: SearchTranscriptsInput,
  ): Promise<TranscriptsPage> {
    return unwrapResult<TranscriptsPage>(this.gateway.searchTranscripts(userId, input))
  }

  readTranscript(
    userId: UserId,
    input: ReadTranscriptInput,
  ): Promise<ReadTranscriptResult> {
    return unwrapResult<ReadTranscriptResult>(this.gateway.readTranscript(userId, input))
  }

  downloadTranscript(
    userId: UserId,
    input: DownloadTranscriptInput,
  ): Promise<ExportTranscriptionResponse> {
    return unwrapResult<ExportTranscriptionResponse>(
      this.gateway.downloadTranscript(userId, input),
    )
  }
}

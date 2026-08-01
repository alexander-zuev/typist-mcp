import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

type StructuredContent = NonNullable<CallToolResult['structuredContent']>

export function toolSuccess(text: string, structuredContent: StructuredContent): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent }
}

/**
 * Success for tools whose payload is a single opaque blob. Clients may render either
 * block and discard the other, so a tool whose answer lives only in one of them must
 * not send both — omitting `structuredContent` leaves nothing to discard.
 */
export function toolText(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

export function toolError(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

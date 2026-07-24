import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

type StructuredContent = NonNullable<CallToolResult['structuredContent']>

export function toolSuccess(
  text: string,
  structuredContent: StructuredContent,
): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent }
}

export function toolError(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

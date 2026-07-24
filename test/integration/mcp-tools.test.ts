import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'

import { connectMcpClient } from '../helpers/mcp-client'
import { obtainAccessToken } from '../helpers/oauth'

const VALID_ID = '11111111-1111-4111-8111-111111111111'
// Mirrors NOT_FOUND_ID in test/fixtures/fake-gateway.js (plain JS, not importable here).
const NOT_FOUND_ID = '00000000-0000-4000-8000-000000000404'

let client: Client | undefined

afterEach(async () => {
  await client?.close()
  client = undefined
})

async function connectAs(userId: string): Promise<Client> {
  client = await connectMcpClient(await obtainAccessToken(userId))
  return client
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? []
  return content.map((block) => block.text ?? '').join('\n')
}

describe('tool surface', () => {
  it('exposes exactly the three read-only tools', async () => {
    const mcp = await connectAs('user-tools-list')
    const { tools } = await mcp.listTools()
    const names = tools.map((tool) => tool.name).sort()
    expect(names).toEqual(['download_transcript', 'read_transcript', 'search_transcripts'])
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true)
      expect(tool.annotations?.openWorldHint).toBe(false)
    }
  })
})

describe('search_transcripts', () => {
  it('lists recent transcripts when query is omitted', async () => {
    const mcp = await connectAs('user-list-a')
    const result = await mcp.callTool({ name: 'search_transcripts', arguments: {} })
    expect(result.isError).toBeFalsy()
    // The fixture embeds the gateway-received userId — proves the id flows from
    // the token props, not from anything the client sent — and which RPC ran.
    expect(textOf(result)).toContain('user-list-a query=none')
    expect(textOf(result)).toContain('LOCKED')
    const structured = result.structuredContent as { items: unknown[]; nextCursor?: string }
    expect(structured.items).toHaveLength(2)
    expect(structured.nextCursor).toBe('cursor-page-2')
  })

  it('passes a present query through to the gateway', async () => {
    const mcp = await connectAs('user-search-a')
    const result = await mcp.callTool({
      name: 'search_transcripts',
      arguments: { query: 'copper' },
    })
    expect(textOf(result)).toContain('user-search-a query=copper')
  })

  it('rejects invalid arguments', async () => {
    const mcp = await connectAs('user-search-invalid')
    const result = await mcp
      .callTool({ name: 'search_transcripts', arguments: { limit: 0 } })
      .catch((error: Error) => error)
    if (result instanceof Error) {
      expect(result.message).toMatch(/invalid/i)
    } else {
      expect(result.isError).toBe(true)
    }
  })
})

describe('read_transcript', () => {
  it('returns an inline chunk with continuation metadata', async () => {
    const mcp = await connectAs('user-read-a')
    const result = await mcp.callTool({
      name: 'read_transcript',
      arguments: { id: VALID_ID },
    })
    expect(result.isError).toBeFalsy()
    const { result: chunk } = result.structuredContent as {
      result: { kind: string; nextOffset?: number; truncated: boolean }
    }
    expect(chunk.kind).toBe('found')
    expect(chunk.truncated).toBe(true)
    expect(chunk.nextOffset).toBe(8000)
    // Body text must live ONLY in the text content block — structured
    // duplication would double the response against client output caps.
    expect('text' in chunk).toBe(false)
    expect(textOf(result)).toContain('offset=0 maxChars=8000 format=txt')
  })

  it('honors offset, maxChars, and format', async () => {
    const mcp = await connectAs('user-read-b')
    const result = await mcp.callTool({
      name: 'read_transcript',
      arguments: { id: VALID_ID, offset: 8000, maxChars: 20_000, format: 'vtt' },
    })
    expect(textOf(result)).toContain('offset=8000 maxChars=20000 format=vtt')
  })

  it('maps not_found to a clean tool error', async () => {
    const mcp = await connectAs('user-read-missing')
    const result = await mcp.callTool({
      name: 'read_transcript',
      arguments: { id: NOT_FOUND_ID },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Transcript not found')
  })
})

describe('download_transcript', () => {
  it('returns a presigned link', async () => {
    const mcp = await connectAs('user-download-a')
    const result = await mcp.callTool({
      name: 'download_transcript',
      arguments: { id: VALID_ID, format: 'srt' },
    })
    const { result: download } = result.structuredContent as {
      result: { downloadUrl: string; format: string }
    }
    expect(download.downloadUrl).toContain('https://r2.test/')
    expect(download.format).toBe('srt')
  })

  it('maps not_found to a clean tool error', async () => {
    const mcp = await connectAs('user-download-missing')
    const result = await mcp.callTool({
      name: 'download_transcript',
      arguments: { id: NOT_FOUND_ID },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Transcript not found')
  })

  it('rejects dashboard-only binary formats', async () => {
    const mcp = await connectAs('user-download-format')
    const result = await mcp
      .callTool({
        name: 'download_transcript',
        arguments: { id: VALID_ID, format: 'pdf' },
      })
      .catch((error: Error) => error)

    if (result instanceof Error) {
      expect(result.message).toMatch(/invalid/i)
    } else {
      expect(result.isError).toBe(true)
    }
  })
})

describe('failure containment', () => {
  it('never leaks internal gateway errors to the agent', async () => {
    const mcp = await connectAs('user-gateway-down')
    const result = await mcp.callTool({ name: 'search_transcripts', arguments: {} })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Something went wrong')
    expect(textOf(result)).not.toContain('D1_ERROR')
  })

  it('returns a retry hint when rate limited', async () => {
    const mcp = await connectAs('user-rate-limited')
    const result = await mcp.callTool({ name: 'search_transcripts', arguments: {} })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Retry in 30 seconds')
  })
})

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
  it('exposes exactly the two read-only tools', async () => {
    const mcp = await connectAs('user-tools-list')
    const { tools } = await mcp.listTools()
    const names = tools.map((tool) => tool.name).sort()
    expect(names).toEqual(['get_transcript', 'search_transcripts'])
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true)
      expect(tool.annotations?.openWorldHint).toBe(false)
    }
  })
})

describe('search_transcripts', () => {
  it('returns the caller-scoped library as structured + text content', async () => {
    const mcp = await connectAs('user-search-a')
    const result = await mcp.callTool({ name: 'search_transcripts', arguments: {} })
    expect(result.isError).toBeFalsy()
    // The fixture embeds the gateway-received userId — proves the id flows from
    // the token props, not from anything the client sent.
    expect(textOf(result)).toContain('owner user-search-a')
    expect(textOf(result)).toContain('LOCKED')
    const structured = result.structuredContent as { items: unknown[]; nextCursor?: string }
    expect(structured.items).toHaveLength(2)
    expect(structured.nextCursor).toBe('cursor-page-2')
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

describe('get_transcript', () => {
  it('returns an inline chunk with continuation metadata', async () => {
    const mcp = await connectAs('user-get-a')
    const result = await mcp.callTool({
      name: 'get_transcript',
      arguments: { id: VALID_ID },
    })
    expect(result.isError).toBeFalsy()
    const { result: chunk } = result.structuredContent as {
      result: { kind: string; nextOffset?: number; truncated: boolean }
    }
    expect(chunk.kind).toBe('inline')
    expect(chunk.truncated).toBe(true)
    expect(chunk.nextOffset).toBe(8000)
    expect(textOf(result)).toContain('offset=0 maxChars=8000 format=txt')
  })

  it('honors offset, maxChars, and format', async () => {
    const mcp = await connectAs('user-get-b')
    const result = await mcp.callTool({
      name: 'get_transcript',
      arguments: { id: VALID_ID, offset: 8000, maxChars: 20_000, format: 'vtt' },
    })
    expect(textOf(result)).toContain('offset=8000 maxChars=20000 format=vtt')
  })

  it('returns a presigned link for delivery=url', async () => {
    const mcp = await connectAs('user-get-url')
    const result = await mcp.callTool({
      name: 'get_transcript',
      arguments: { id: VALID_ID, delivery: 'url', format: 'srt' },
    })
    const { result: chunk } = result.structuredContent as {
      result: { kind: string; url: string }
    }
    expect(chunk.kind).toBe('url')
    expect(chunk.url).toContain('https://r2.test/')
  })

  it('maps EntityNotFoundError to a clean not-found tool error', async () => {
    const mcp = await connectAs('user-get-missing')
    const result = await mcp.callTool({
      name: 'get_transcript',
      arguments: { id: NOT_FOUND_ID },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Transcript not found')
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

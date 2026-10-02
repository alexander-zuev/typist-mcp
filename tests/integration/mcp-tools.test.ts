import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { connectMcpClient, connectMcpSession } from '../helpers/mcp-client'
import { MCP_ORIGIN, obtainAccessToken, selfFetch } from '../helpers/oauth'
import { afterEach, describe, expect, it } from './test'

const VALID_ID = '11111111-1111-4111-8111-111111111111'
// Mirrors NOT_FOUND_ID in test/fixtures/fake-gateway.js (plain JS, not importable here).
const NOT_FOUND_ID = '00000000-0000-4000-8000-000000000404'

let client: Client | undefined

function testUserId(label: string): string {
  return label.replaceAll('-', '').padEnd(32, '0').slice(0, 32)
}

afterEach(async () => {
  await client?.close()
  client = undefined
})

async function connectAs(userId: string): Promise<Client> {
  client = await connectMcpClient(await obtainAccessToken(testUserId(userId)))
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
    expect(textOf(result)).toContain(`${testUserId('user-list-a')} query=none`)
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
    expect(textOf(result)).toContain(`${testUserId('user-search-a')} query=copper`)
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

  it('rejects an inverted date range at the MCP boundary', async () => {
    const mcp = await connectAs('user-search-dates')
    const result = await mcp.callTool({
      name: 'search_transcripts',
      arguments: { from: '2026-07-25', to: '2026-07-24' },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/from.*on or before.*to/i)
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
    // Regression guard: this tool must send ONE block. A client is free to render
    // structuredContent and drop the text block, which is exactly how the transcript
    // body went missing when the two blocks carried different data.
    expect(result.structuredContent).toBeUndefined()
    const text = textOf(result)
    expect(text).toContain('offset=0 maxChars=2000 format=txt')
    expect(text).toContain('totalChars: 100000\ntruncated: true\nnextOffset: 2000')
  })

  it('honors offset, maxChars, and format', async () => {
    const mcp = await connectAs('user-read-b')
    const result = await mcp.callTool({
      name: 'read_transcript',
      arguments: { id: VALID_ID, offset: 8000, maxChars: 20_000, format: 'vtt' },
    })
    expect(textOf(result)).toContain('offset=8000 maxChars=20000 format=vtt')
  })

  it('delivers the body whether or not segments are requested', async () => {
    const mcp = await connectAs('user-read-segments')
    const [off, on] = await Promise.all([
      mcp.callTool({ name: 'read_transcript', arguments: { id: VALID_ID } }),
      mcp.callTool({
        name: 'read_transcript',
        arguments: { id: VALID_ID, includeSegments: true },
      }),
    ])
    for (const result of [off, on]) {
      expect(result.structuredContent).toBeUndefined()
      expect(textOf(result)).toContain('chunk for')
    }
    // Timestamps ride inside the body, and `segments` is never rendered as its own
    // block — a separate index would repeat the text and still need matching back onto it.
    expect(textOf(on)).toContain('[0:00] chunk for')
    expect(textOf(off)).not.toContain('[0:00]')
    expect(textOf(on)).not.toContain('--- segments')
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
  it('rejects a session id presented by a different authenticated user', async () => {
    const owner = await connectMcpSession(await obtainAccessToken(testUserId('user-session-owner')))
    client = owner.client
    const attackerToken = await obtainAccessToken(testUserId('user-session-attacker'))
    const response = await selfFetch(`${MCP_ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${attackerToken}`,
        'content-type': 'application/json',
        'mcp-session-id': owner.transport.sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search_transcripts', arguments: {} },
      }),
    })
    expect(response.status).toBe(404)
  })

  it('never leaks internal gateway errors to the agent', async () => {
    const mcp = await connectAs('user-gateway-down')
    const result = await mcp.callTool({ name: 'search_transcripts', arguments: {} })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Something went wrong')
    expect(textOf(result)).not.toContain('D1_ERROR')
  })
})

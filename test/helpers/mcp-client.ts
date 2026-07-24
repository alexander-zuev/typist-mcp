import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { MCP_ORIGIN, selfFetch } from './oauth'

/** Real MCP SDK client speaking streamable HTTP to the worker under test. */
export async function connectMcpClient(accessToken: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', MCP_ORIGIN), {
    // Swallow the AbortErrors the transport triggers when closing its SSE
    // streams — they surface as unhandled rejections in the workers pool.
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      try {
        return await selfFetch(new Request(url, init))
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return new Response(null, { status: 499 })
        }
        throw error
      }
    },
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  })
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(transport)
  return client
}

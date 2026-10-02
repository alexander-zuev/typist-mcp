import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { MCP_ORIGIN, selfFetch } from './oauth'

export interface McpTestSession {
  client: Client
  transport: StreamableHTTPClientTransport
}

/** Real MCP SDK client speaking streamable HTTP to the worker under test. */
export async function connectMcpSession(accessToken: string): Promise<McpTestSession> {
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', MCP_ORIGIN), {
    fetch: (url, init) => selfFetch(new Request(url, init)),
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  })
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(transport)
  return { client, transport }
}

export async function connectMcpClient(accessToken: string): Promise<Client> {
  return (await connectMcpSession(accessToken)).client
}

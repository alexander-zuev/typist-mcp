import { mcpTokenPropsSchema } from './mcp-token-props'

const SESSION_OWNER_PREFIX = 'mcp-session-owner:'
const SESSION_OWNER_TTL_SECONDS = 30 * 24 * 60 * 60

interface McpFetchHandler {
  fetch(request: Request, env: McpEnv, ctx: ExecutionContext): Response | Promise<Response>
}

function sessionNotFound(): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Session not found' },
      id: null,
    },
    { status: 404 },
  )
}

function sessionOwnerKey(sessionId: string): string {
  return `${SESSION_OWNER_PREFIX}${sessionId}`
}

async function requireSessionOwner(
  env: McpEnv,
  sessionId: string,
  userId: string,
): Promise<Response | null> {
  const owner = await env.OAUTH_KV.get(sessionOwnerKey(sessionId))
  return owner === userId ? null : sessionNotFound()
}

async function rememberSessionOwner(env: McpEnv, sessionId: string, userId: string): Promise<void> {
  await env.OAUTH_KV.put(sessionOwnerKey(sessionId), userId, {
    expirationTtl: SESSION_OWNER_TTL_SECONDS,
  })
}

/**
 * Binds every SDK-managed MCP session to the authenticated OAuth user.
 * A stolen session id cannot be replayed with another user's valid token.
 */
export function createUserBoundMcpHandler(handler: McpFetchHandler): McpFetchHandler {
  return {
    async fetch(request, env, ctx) {
      const props = mcpTokenPropsSchema.parse(Reflect.get(ctx, 'props'))
      const requestSessionId = request.headers.get('mcp-session-id')

      if (requestSessionId) {
        const rejection = await requireSessionOwner(env, requestSessionId, props.userId)
        if (rejection) return rejection
      }

      const response = await handler.fetch(request, env, ctx)
      const responseSessionId = response.headers.get('mcp-session-id')

      if (!requestSessionId && response.ok && responseSessionId) {
        await rememberSessionOwner(env, responseSessionId, props.userId)
      } else if (requestSessionId && request.method === 'DELETE' && response.ok) {
        await env.OAUTH_KV.delete(sessionOwnerKey(requestSessionId))
      }

      return response
    },
  }
}

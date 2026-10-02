import { AuthenticationError, ok, userIdSchema, type McpGatewayContract } from '@typist/core'
import { describe, expect, it, vi } from './test'

import { McpGatewayClient } from '../../src/infrastructure/clients/mcp-gateway-client'

const gateway = {
  getSession: vi.fn<McpGatewayContract['getSession']>(),
  searchTranscripts: vi.fn<McpGatewayContract['searchTranscripts']>(),
  readTranscript: vi.fn<McpGatewayContract['readTranscript']>(),
  downloadTranscript: vi.fn<McpGatewayContract['downloadTranscript']>(),
}

describe('McpGatewayClient', () => {
  it('unwraps successful gateway results', async () => {
    const session = {
      userId: userIdSchema.parse('a'.repeat(32)),
      isAnonymous: false,
    } as const
    vi.mocked(gateway.getSession).mockResolvedValue(ok(session))

    await expect(new McpGatewayClient(gateway).getSession('cookie')).resolves.toEqual(session)
  })

  it('unwraps returned gateway errors', async () => {
    vi.mocked(gateway.getSession).mockResolvedValue({
      status: 'error',
      error: { code: 'UNAUTHENTICATED', message: 'Sign in required', retryable: false },
    })

    await expect(new McpGatewayClient(gateway).getSession('cookie')).rejects.toBeInstanceOf(
      AuthenticationError,
    )
  })

  it('preserves errors thrown by the binding', async () => {
    const failure = new TypeError('Binding failed')
    vi.mocked(gateway.getSession).mockRejectedValue(failure)

    await expect(new McpGatewayClient(gateway).getSession('cookie')).rejects.toBe(failure)
  })
})

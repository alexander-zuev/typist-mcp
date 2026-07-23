import { describe, expect, it } from 'vitest'
import {
  authorizeAndApprove,
  authorizeUrl,
  createPkcePair,
  exchangeCode,
  MCP_ORIGIN,
  registerClient,
  selfFetch,
  sessionCookie,
} from '../helpers/oauth'

describe('discovery', () => {
  it('serves authorization server metadata', async () => {
    const response = await selfFetch(`${MCP_ORIGIN}/.well-known/oauth-authorization-server`)
    expect(response.status).toBe(200)
    const metadata: Record<string, unknown> = await response.json()
    expect(metadata.authorization_endpoint).toBe(`${MCP_ORIGIN}/authorize`)
    expect(metadata.token_endpoint).toBe(`${MCP_ORIGIN}/token`)
    expect(metadata.registration_endpoint).toBe(`${MCP_ORIGIN}/register`)
    expect(metadata.scopes_supported).toContain('transcripts:read')
  })
})

describe('/mcp bearer gate', () => {
  it('rejects requests without a token', async () => {
    const response = await selfFetch(`${MCP_ORIGIN}/mcp`, { method: 'POST' })
    expect(response.status).toBe(401)
  })

  it('rejects a malformed bearer token', async () => {
    const response = await selfFetch(`${MCP_ORIGIN}/mcp`, {
      method: 'POST',
      headers: { authorization: 'Bearer not-a-real-token' },
    })
    expect(response.status).toBe(401)
  })
})

describe('/authorize', () => {
  it('redirects to sign-in without a session, preserving the return URL', async () => {
    const clientId = await registerClient()
    const { challenge } = await createPkcePair()
    const response = await selfFetch(authorizeUrl(clientId, challenge), { redirect: 'manual' })
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.origin).toBe('https://app.test')
    expect(location.pathname).toBe('/sign-in')
    expect(location.searchParams.get('redirect')).toContain('/authorize')
  })

  it('redirects anonymous sessions to sign-in (anon gate)', async () => {
    const clientId = await registerClient()
    const { challenge } = await createPkcePair()
    const response = await selfFetch(authorizeUrl(clientId, challenge), {
      headers: { cookie: sessionCookie('anon-user-1', { anonymous: true }) },
      redirect: 'manual',
    })
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.pathname).toBe('/sign-in')
  })

  it('redirects a signed-in user to the consent page with client info and state', async () => {
    const clientId = await registerClient()
    const { challenge } = await createPkcePair()
    const response = await selfFetch(authorizeUrl(clientId, challenge), {
      headers: { cookie: sessionCookie('user-consent-1') },
      redirect: 'manual',
    })
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.origin).toBe('https://app.test')
    expect(location.pathname).toBe('/mcp/consent')
    expect(location.searchParams.get('client_name')).toBe('Test Agent')
    expect(location.searchParams.get('scope')).toBe('transcripts:read')
    expect(location.searchParams.get('state')).toBeTruthy()
  })

  it('rejects an unknown client', async () => {
    const { challenge } = await createPkcePair()
    const response = await selfFetch(authorizeUrl('ghost-client', challenge), {
      headers: { cookie: sessionCookie('user-unknown-client') },
      redirect: 'manual',
    })
    expect(response.status).toBe(400)
  })
})

describe('/approve', () => {
  async function consentState(clientId: string, challenge: string, userId: string) {
    const response = await selfFetch(authorizeUrl(clientId, challenge), {
      headers: { cookie: sessionCookie(userId) },
      redirect: 'manual',
    })
    const location = new URL(response.headers.get('location') ?? '')
    const state = location.searchParams.get('state')
    if (!state) throw new Error('missing state')
    return state
  }

  it('rejects a tampered state', async () => {
    const clientId = await registerClient()
    const { challenge } = await createPkcePair()
    const state = await consentState(clientId, challenge, 'user-tamper-1')
    const response = await selfFetch(`${MCP_ORIGIN}/approve`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie('user-tamper-1'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ state: `${state}x`, decision: 'allow' }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects a state minted for a different user (consent CSRF guard)', async () => {
    const clientId = await registerClient()
    const { challenge } = await createPkcePair()
    const state = await consentState(clientId, challenge, 'user-victim-1')
    const response = await selfFetch(`${MCP_ORIGIN}/approve`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie('user-attacker-1'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ state, decision: 'allow' }),
    })
    expect(response.status).toBe(403)
  })

  it('redirects deny back to the client with access_denied', async () => {
    const clientId = await registerClient()
    const { challenge } = await createPkcePair()
    const state = await consentState(clientId, challenge, 'user-deny-1')
    const response = await selfFetch(`${MCP_ORIGIN}/approve`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie('user-deny-1'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ state, decision: 'deny' }),
      redirect: 'manual',
    })
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.origin).toBe('https://client.test')
    expect(location.searchParams.get('error')).toBe('access_denied')
    expect(location.searchParams.get('state')).toBe('client-state')
  })

  it('rejects an invalid decision value', async () => {
    const response = await selfFetch(`${MCP_ORIGIN}/approve`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie('user-bad-decision'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ state: 'whatever', decision: 'maybe' }),
    })
    expect(response.status).toBe(400)
  })
})

describe('full connect flow', () => {
  it('issues a working access token via DCR + PKCE + consent', async () => {
    const clientId = await registerClient()
    const { verifier, challenge } = await createPkcePair()
    const code = await authorizeAndApprove(clientId, challenge, sessionCookie('user-happy-1'))
    const token = await exchangeCode(clientId, code, verifier)
    expect(token).toBeTruthy()

    const response = await selfFetch(`${MCP_ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'probe', version: '1.0.0' },
        },
      }),
    })
    expect(response.status).toBe(200)
  })

  it('rejects the token exchange with a wrong PKCE verifier', async () => {
    const clientId = await registerClient()
    const { challenge } = await createPkcePair()
    const { verifier: wrongVerifier } = await createPkcePair()
    const code = await authorizeAndApprove(clientId, challenge, sessionCookie('user-pkce-1'))
    await expect(exchangeCode(clientId, code, wrongVerifier)).rejects.toThrow(
      /token exchange failed/,
    )
  })
})

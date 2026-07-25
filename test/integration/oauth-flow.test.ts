import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import {
  authorizeAndApprove,
  authorizeUrl,
  createPkcePair,
  exchangeCode,
  expireAccessToken,
  MCP_ORIGIN,
  obtainAccessToken,
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
  })

  it('serves protected resource metadata (RFC 9728, required by the MCP spec)', async () => {
    const response = await selfFetch(`${MCP_ORIGIN}/.well-known/oauth-protected-resource`)
    expect(response.status).toBe(200)
    const metadata: Record<string, unknown> = await response.json()
    expect(metadata.authorization_servers).toContain(MCP_ORIGIN)
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

  it('rejects a revoked access token', async () => {
    const userId = 'RevokedTestUserId000000000000001'
    const clientId = await registerClient()
    const { verifier, challenge } = await createPkcePair()
    const code = await authorizeAndApprove(clientId, challenge, sessionCookie(userId))
    const token = await exchangeCode(clientId, code, verifier)
    const [, grantId] = token.split(':')
    if (!grantId) throw new Error('token missing grant id')
    const oauthEnv = env as typeof env & {
      OAUTH_PROVIDER: { revokeGrant(grantId: string, userId: string): Promise<void> }
    }
    await oauthEnv.OAUTH_PROVIDER.revokeGrant(grantId, userId)

    const response = await selfFetch(`${MCP_ORIGIN}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(401)
  })

  it('rejects an expired access token', async () => {
    const token = await obtainAccessToken('ExpiredTestUserId000000000000001')
    await expireAccessToken(token)
    const response = await selfFetch(`${MCP_ORIGIN}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
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
    expect(location.searchParams.get('intent')).toBe('mcp-connect')
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

  it('rejects plain PKCE', async () => {
    const clientId = await registerClient()
    const requestUrl = new URL(authorizeUrl(clientId, 'plain-verifier'))
    requestUrl.searchParams.set('code_challenge_method', 'plain')
    const response = await selfFetch(requestUrl.toString(), {
      headers: { cookie: sessionCookie('PlainPkceTestUserId0000000000001') },
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
      redirect: 'manual',
    })
    const location = new URL(response.headers.get('location') ?? '')
    expect([response.status, location.pathname, location.searchParams.get('reason')]).toEqual([
      302,
      '/mcp/consent/error',
      'expired',
    ])
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
      redirect: 'manual',
    })
    const location = new URL(response.headers.get('location') ?? '')
    expect([response.status, location.pathname, location.searchParams.get('reason')]).toEqual([
      302,
      '/mcp/consent/error',
      'account-mismatch',
    ])
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

  it('rejects a replayed state (single use)', async () => {
    const clientId = await registerClient()
    const { challenge } = await createPkcePair()
    const state = await consentState(clientId, challenge, 'user-replay-1')
    const approve = () =>
      selfFetch(`${MCP_ORIGIN}/approve`, {
        method: 'POST',
        headers: {
          cookie: sessionCookie('user-replay-1'),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ state, decision: 'allow' }),
        redirect: 'manual',
      })
    expect((await approve()).status).toBe(302)
    const replay = await approve()
    const location = new URL(replay.headers.get('location') ?? '')
    expect([replay.status, location.pathname, location.searchParams.get('reason')]).toEqual([
      302,
      '/mcp/consent/error',
      'already-used',
    ])
  })

  it('recovers a lost session by resuming at the consent page, not the POST URL', async () => {
    const clientId = await registerClient()
    const { challenge } = await createPkcePair()
    const state = await consentState(clientId, challenge, 'user-lost-session')
    const response = await selfFetch(`${MCP_ORIGIN}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ state, decision: 'allow' }),
      redirect: 'manual',
    })
    expect(response.status).toBe(302)
    const signIn = new URL(response.headers.get('location') ?? '')
    expect(signIn.pathname).toBe('/sign-in')
    const resume = new URL(signIn.searchParams.get('redirect') ?? '')
    expect(resume.pathname).toBe('/mcp/consent')
    expect(resume.searchParams.get('state')).toBe(state)
  })

  it('rejects non-web client metadata URIs at registration (first line before the consent allowlist)', async () => {
    await expect(
      // oxlint-disable-next-line no-script-url -- the attack input under test
      registerClient({ logo_uri: 'javascript:alert(1)' }),
    ).rejects.toThrow(/register failed: 400/)
  })

  it('forwards web client metadata URIs to the consent redirect', async () => {
    const clientId = await registerClient({
      logo_uri: 'https://cdn.example/logo.png',
      client_uri: 'https://legit.example',
    })
    const { challenge } = await createPkcePair()
    const response = await selfFetch(authorizeUrl(clientId, challenge), {
      headers: { cookie: sessionCookie('user-logo-filter') },
      redirect: 'manual',
    })
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.searchParams.get('logo_uri')).toBe('https://cdn.example/logo.png')
    expect(location.searchParams.get('client_uri')).toBe('https://legit.example')
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
    const code = await authorizeAndApprove(
      clientId,
      challenge,
      sessionCookie('OAuthHappyUser000000000000000001'),
    )
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

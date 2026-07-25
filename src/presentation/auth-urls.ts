import type { ClientInfo } from '@cloudflare/workers-oauth-provider'
import {
  MCP_CONSENT_ERROR_PATH,
  MCP_SIGN_IN_INTENT,
  type McpConsentErrorReason,
} from '@typist/core'

export function signInRedirect(mainAppUrl: string, returnTo: string): Response {
  const signIn = new URL('/sign-in', mainAppUrl)
  signIn.searchParams.set('redirect', returnTo)
  signIn.searchParams.set('intent', MCP_SIGN_IN_INTENT)
  return Response.redirect(signIn.toString(), 302)
}

export function consentErrorUrl(mainAppUrl: string, reason: McpConsentErrorReason): string {
  const errorUrl = new URL(MCP_CONSENT_ERROR_PATH, mainAppUrl)
  errorUrl.searchParams.set('reason', reason)
  return errorUrl.toString()
}

/** Builds the consent URL while excluding unsafe client-controlled metadata URLs. */
export function consentUrl(
  mainAppUrl: string,
  state: string,
  client: ClientInfo,
  clientId: string,
): string {
  const consent = new URL('/mcp/consent', mainAppUrl)
  consent.searchParams.set('state', state)
  consent.searchParams.set('client_name', client.clientName ?? clientId)
  if (isWebUrl(client.logoUri)) consent.searchParams.set('logo_uri', client.logoUri)
  if (isWebUrl(client.clientUri)) consent.searchParams.set('client_uri', client.clientUri)
  return consent.toString()
}

function isWebUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

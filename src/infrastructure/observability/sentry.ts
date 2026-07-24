import { createSentryOptions } from '@typist/core'

export function createMcpServerSentryOptions(env: McpEnv) {
  return createSentryOptions(env)
}

export function createMcpServerDurableObjectSentryOptions(env: McpEnv) {
  return {
    ...createSentryOptions(env),
  }
}

import path from 'node:path'

import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

/**
 * All tests run in the workers pool against the real worker (OAuth provider,
 * McpAgent DO, KV). The main app's side of the contract is a fixture worker:
 * TYPIST_GATEWAY resolves to `test/fixtures/fake-gateway.js` (named entrypoint
 * McpGateway) and RATE_LIMITER to its FakeRateLimiterDO.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './wrangler.jsonc',
        environment: 'test',
      },
      miniflare: {
        compatibilityDate: '2026-02-24',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          MCP_STATE_SECRET: 'test-state-secret-32-chars-long!',
        },
        serviceBindings: {
          TYPIST_GATEWAY: { name: 'fake-gateway', entrypoint: 'McpGateway' },
        },
        durableObjects: {
          RATE_LIMITER: { className: 'FakeRateLimiterDO', scriptName: 'fake-gateway' },
        },
        workers: [
          {
            name: 'fake-gateway',
            modules: true,
            scriptPath: path.join(import.meta.dirname, 'test/fixtures/fake-gateway.js'),
            compatibilityDate: '2026-02-24',
            compatibilityFlags: ['nodejs_compat'],
          },
        ],
      },
    }),
  ],
  test: {
    reporters: ['dot'],
    include: ['test/**/*.test.ts'],
    // The MCP streamable-HTTP transport aborts per-request SSE bodies by
    // design; the server-side stream rejections land in the shared isolate as
    // unhandled AbortErrors. Ignore only those — anything else still fails.
    onUnhandledError(error) {
      if (error.name === 'AbortError') return false
    },
  },
})

import path from 'node:path'

import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    reporters: ['dot'],
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          isolate: true,
          maxWorkers: 4,
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc', environment: 'test' },
            miniflare: {
              workers: [
                {
                  name: 'fake-gateway',
                  modules: true,
                  scriptPath: path.join(import.meta.dirname, 'tests/fixtures/fake-gateway.js'),
                  compatibilityDate: '2026-05-22',
                  compatibilityFlags: ['nodejs_compat'],
                },
              ],
            },
          }),
        ],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          isolate: false,
          fileParallelism: false,
        },
      },
    ],
  },
})

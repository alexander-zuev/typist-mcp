import { reset } from 'cloudflare:test'
import { test as base, vi } from 'vitest'

export const test = base.extend('clean', { auto: true }, async ({onTestFinished}) => {
  await reset()
  vi.clearAllMocks()
  onTestFinished(() => { vi.restoreAllMocks() })
})
export const it = test
export const { beforeEach, afterEach, beforeAll, afterAll } = test
export { describe, expect, vi } from 'vitest'

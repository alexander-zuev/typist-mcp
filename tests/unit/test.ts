import { test as base, vi } from 'vitest'
import { createClock } from '../fixtures/clock'

export const test = base
  .extend('clean', { auto: true }, ({onTestFinished}) => {
    vi.clearAllMocks()
    onTestFinished(() => { vi.restoreAllMocks() })
  })
  .extend('clock', ({onTestFinished}) => createClock(onTestFinished))
export const it = test
export const { beforeEach, afterEach, beforeAll, afterAll } = test
export { describe, expect, vi, expectTypeOf } from 'vitest'
export type { TestContext, Mock, MockInstance } from 'vitest'

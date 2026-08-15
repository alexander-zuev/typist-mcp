import { userIdSchema, type BurstLimiter } from '@typist/core'
import { describe, expect, it, vi } from 'vitest'

import { executeTool } from '../../src/entrypoints/tools/tool-execution'

const userId = userIdSchema.parse('a'.repeat(32))

describe('executeTool', () => {
  it('returns a retry hint when the burst limiter denies', async () => {
    const burst: BurstLimiter = { consume: vi.fn().mockResolvedValue(false) }
    const execute = vi.fn()

    const result = await executeTool({ burst, userId }, 'search_transcripts', execute)

    expect(result.isError).toBe(true)
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Rate limit exceeded. Retry in 60 seconds.',
    })
    expect(execute).not.toHaveBeenCalled()
    expect(burst.consume).toHaveBeenCalledWith(`mcp:search_transcripts:${userId}`)
  })
})

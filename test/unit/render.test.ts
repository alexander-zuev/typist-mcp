import type { GetTranscriptResult, SearchTranscriptsResult } from '@typist/core'
import { describe, expect, it } from 'vitest'
import { renderSearchResult, renderTranscriptResult } from '../../src/render'

const item = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Board Meeting',
  duration: 125,
  uploadedAt: '2026-07-20T10:00:00.000Z',
  category: 'meeting',
  topics: ['budget'],
  locked: false,
} satisfies SearchTranscriptsResult['items'][number]

describe('renderSearchResult', () => {
  it('renders empty state', () => {
    expect(renderSearchResult({ items: [] })).toBe('No transcripts found')
  })

  it('renders rows with duration and pagination hint', () => {
    const text = renderSearchResult({ items: [item], nextCursor: 'cur-1' })
    expect(text).toContain('Board Meeting')
    expect(text).toContain('2:05')
    expect(text).toContain('cursor "cur-1"')
  })

  it('flags locked items', () => {
    const text = renderSearchResult({ items: [{ ...item, locked: true }] })
    expect(text).toContain('LOCKED')
  })
})

describe('renderTranscriptResult', () => {
  const meta = {
    id: item.id,
    displayName: 'Board Meeting',
    language: 'en',
    duration: 125,
    category: null,
    topics: null,
    locked: false,
  }

  it('renders a truncated inline chunk with continuation hint', () => {
    const result: GetTranscriptResult = {
      ...meta,
      kind: 'inline',
      text: 'hello world',
      offset: 0,
      nextOffset: 11,
      totalChars: 100,
      truncated: true,
    }
    const text = renderTranscriptResult(result)
    expect(text).toContain('offset=11')
    expect(text).toContain('hello world')
  })

  it('renders a complete chunk and a locked preview note', () => {
    const result: GetTranscriptResult = {
      ...meta,
      locked: true,
      kind: 'inline',
      text: 'preview text',
      offset: 0,
      totalChars: 12,
      truncated: false,
    }
    const text = renderTranscriptResult(result)
    expect(text).toContain('complete')
    expect(text).toContain('locked')
  })

  it('renders the url variant', () => {
    const result: GetTranscriptResult = {
      ...meta,
      kind: 'url',
      url: 'https://r2.test/export.txt',
      expiresAt: '2026-07-23T20:00:00.000Z',
      format: 'srt',
    }
    const text = renderTranscriptResult(result)
    expect(text).toContain('https://r2.test/export.txt')
    expect(text).toContain('srt')
  })
})

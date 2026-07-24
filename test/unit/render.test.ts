import type { DownloadTranscriptResult, ReadTranscriptResult, TranscriptsPage } from '@typist/core'
import { describe, expect, it } from 'vitest'
import { renderDownloadResult, renderReadResult, renderTranscriptsPage } from '../../src/render'

const item = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Board Meeting',
  duration: 125,
  uploadedAt: '2026-07-20T10:00:00.000Z',
  category: 'meeting',
  topics: ['budget'],
  locked: false,
} satisfies TranscriptsPage['items'][number]

const meta = {
  id: item.id,
  displayName: 'Board Meeting',
  language: 'en',
  duration: 125,
  category: null,
  topics: null,
  locked: false,
}

describe('renderTranscriptsPage', () => {
  it('renders empty state', () => {
    expect(renderTranscriptsPage({ items: [] })).toBe('No transcripts found')
  })

  it('renders rows with duration and pagination hint', () => {
    const text = renderTranscriptsPage({ items: [item], nextCursor: 'cur-1' })
    expect(text).toContain('Board Meeting')
    expect(text).toContain('2:05')
    expect(text).toContain('cursor "cur-1"')
  })

  it('flags locked items', () => {
    const text = renderTranscriptsPage({ items: [{ ...item, locked: true }] })
    expect(text).toContain('LOCKED')
  })
})

describe('renderReadResult', () => {
  it('renders a truncated chunk with continuation hint', () => {
    const result: Exclude<ReadTranscriptResult, { kind: 'not_found' }> = {
      ...meta,
      kind: 'found',
      text: 'hello world',
      offset: 0,
      nextOffset: 11,
      totalChars: 100,
      truncated: true,
    }
    const text = renderReadResult(result)
    expect(text).toContain('offset=11')
    expect(text).toContain('hello world')
  })

  it('renders a complete chunk and a locked preview note', () => {
    const result: Exclude<ReadTranscriptResult, { kind: 'not_found' }> = {
      ...meta,
      locked: true,
      kind: 'found',
      text: 'preview text',
      offset: 0,
      totalChars: 12,
      truncated: false,
    }
    const text = renderReadResult(result)
    expect(text).toContain('complete')
    expect(text).toContain('locked')
  })
})

describe('renderDownloadResult', () => {
  it('renders the download link with format and expiry', () => {
    const result: Exclude<DownloadTranscriptResult, { kind: 'not_found' }> = {
      ...meta,
      kind: 'found',
      url: 'https://r2.test/export.srt',
      expiresAt: '2026-07-24T20:00:00.000Z',
      format: 'srt',
    }
    const text = renderDownloadResult(result)
    expect(text).toContain('https://r2.test/export.srt')
    expect(text).toContain('srt')
  })
})

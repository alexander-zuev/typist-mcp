import type {
  ExportTranscriptionResponse,
  ReadTranscriptResult,
  TranscriptsPage,
} from '@typist/core'
import { describe, expect, it } from './test'

import {
  renderDownloadResult,
  renderReadResult,
  renderTranscriptsPage,
} from '../../src/presentation/tool-result-renderers'

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
  it('renders a truncated chunk as front matter above the body', () => {
    const result: Exclude<ReadTranscriptResult, { kind: 'not_found' }> = {
      ...meta,
      kind: 'found',
      text: 'hello world',
      offset: 0,
      nextOffset: 11,
      totalChars: 100,
      truncated: true,
    }
    // These keys are the caller's only handle on paging — this tool sends no
    // structuredContent — so the block is asserted whole, not by substring.
    expect(renderReadResult(result)).toBe(
      [
        '---',
        'title: "Board Meeting"',
        'offset: 0',
        'chars: 11',
        'totalChars: 100',
        'truncated: true',
        'nextOffset: 11',
        'locked: false',
        '---',
        '',
        'hello world',
      ].join('\n'),
    )
  })

  it('closes the fence before a body that starts with a delimiter', () => {
    const result: Exclude<ReadTranscriptResult, { kind: 'not_found' }> = {
      // A filename may contain the delimiter; that ambiguity is why the header is fenced.
      ...meta,
      displayName: 'Q3 | Board: notes.mp4',
      kind: 'found',
      text: '--- not front matter',
      offset: 0,
      totalChars: 20,
      truncated: false,
    }
    const lines = renderReadResult(result).split('\n')
    expect(lines[1]).toBe('title: "Q3 | Board: notes.mp4"')
    expect(lines.indexOf('---', 1)).toBe(lines.length - 3)
  })

  it('omits nextOffset on a complete chunk and states locked outright', () => {
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
    expect(text).toContain('truncated: false')
    expect(text).toContain('locked: true')
    expect(text).not.toContain('nextOffset')
  })

  it('renders the body verbatim when segments are present', () => {
    const result: Exclude<ReadTranscriptResult, { kind: 'not_found' }> = {
      ...meta,
      kind: 'found',
      text: '[0:01] alpha [0:02] beta',
      offset: 0,
      totalChars: 24,
      truncated: false,
      segments: [
        { id: 4, start: 1, end: 2.5, text: 'alpha', speakerId: 'S1' },
        { id: 5, start: 2.5, end: 3, text: 'beta', speakerId: null },
      ],
    }
    const text = renderReadResult(result)
    // Timestamps arrive woven into the body. A separate index would repeat every
    // segment and still leave the agent matching it back onto the text.
    expect(text.endsWith('---\n\n[0:01] alpha [0:02] beta')).toBe(true)
    expect(text.match(/alpha/g)).toHaveLength(1)
  })
})

describe('renderDownloadResult', () => {
  it('renders the download link with format and expiry', () => {
    const result: ExportTranscriptionResponse = {
      downloadUrl: 'https://r2.test/export.srt',
      expiresAt: '2026-07-24T20:00:00.000Z',
      format: 'srt',
    }
    const text = renderDownloadResult(result)
    expect(text).toContain('https://r2.test/export.srt')
    expect(text).toContain('srt')
  })
})

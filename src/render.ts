import type {
  DownloadTranscriptResult,
  ReadTranscriptResult,
  TranscriptsPage,
} from '@typist/core'

/**
 * Compact text renderings of the structured tool results. The text content
 * block is what token-constrained clients show verbatim, so it stays terse;
 * `structuredContent` carries the full DTO.
 */

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '?'
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function renderTranscriptsPage(result: TranscriptsPage): string {
  if (result.items.length === 0) return 'No transcripts found'
  const lines = result.items.map((item) => {
    const parts = [
      item.id,
      item.displayName,
      formatDuration(item.duration),
      item.uploadedAt,
      item.category ?? '-',
      item.topics?.length ? item.topics.join(', ') : '-',
    ]
    if (item.locked) parts.push('LOCKED (preview only until unlocked)')
    return parts.join(' | ')
  })
  const header = `${result.items.length} transcript${result.items.length === 1 ? '' : 's'} (id | name | duration | uploaded | category | topics)`
  const footer = result.nextCursor
    ? `More available — pass cursor "${result.nextCursor}" to fetch the next page`
    : ''
  return [header, ...lines, footer].filter(Boolean).join('\n')
}

export function renderReadResult(
  result: Exclude<ReadTranscriptResult, { kind: 'not_found' }>,
): string {
  const notes: string[] = []
  if (result.locked) notes.push('locked — preview only')
  if (result.truncated && result.nextOffset !== undefined) {
    notes.push(`chars ${result.offset}-${result.offset + result.text.length} of ${result.totalChars}, continue with offset=${result.nextOffset}`)
  } else {
    notes.push(`chars ${result.offset}-${result.offset + result.text.length} of ${result.totalChars}, complete`)
  }
  return `${result.displayName} (${notes.join('; ')})\n\n${result.text}`
}

export function renderDownloadResult(
  result: Exclude<DownloadTranscriptResult, { kind: 'not_found' }>,
): string {
  return `${result.displayName}: download ${result.format} at ${result.url} (expires ${result.expiresAt})`
}

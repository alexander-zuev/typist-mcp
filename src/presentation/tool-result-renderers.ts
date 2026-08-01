import type {
  ExportTranscriptionResponse,
  ReadTranscriptResult,
  TranscriptsPage,
} from '@typist/core'

/**
 * Compact presentation of tool results for the text content block, which is what
 * token-constrained clients show verbatim. Where a tool also sends `structuredContent`,
 * that block carries the same facts as the full DTO — a renderer must never be the only
 * carrier of data the caller needs.
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

/** Quoted so a title containing `:`, a quote, or a newline cannot break the block. */
function yamlScalar(value: string | number | boolean): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

/**
 * Front matter, not a single header line: `title` is a filename and may itself contain the
 * delimiter, which made a one-line `name | key=value` header ambiguous to parse. A `---`
 * fence ends on a line, so the body always starts in an unambiguous place.
 *
 * Every field is stated outright, including ones derivable from the others (`truncated`,
 * `nextOffset`). This tool sends no structuredContent, so these keys are the caller's only
 * handle on paging, and an agent asked to compute one will eventually compute it wrong.
 */
export function renderReadResult(
  result: Exclude<ReadTranscriptResult, { kind: 'not_found' }>,
): string {
  const fields: Array<[string, string | number | boolean]> = [
    ['title', result.displayName],
    ['offset', result.offset],
    ['chars', result.text.length],
    ['totalChars', result.totalChars],
    ['truncated', result.truncated],
  ]
  if (result.nextOffset !== undefined) fields.push(['nextOffset', result.nextOffset])
  fields.push(['locked', result.locked])

  const frontMatter = fields.map(([key, value]) => `${key}: ${yamlScalar(value)}`)
  // `segments` needs no rendering of its own: with includeSegments the body already
  // carries [m:ss] markers inline, which is the only form that lets an agent say when
  // something was said without matching a separate index back onto the text.
  return `---\n${frontMatter.join('\n')}\n---\n\n${result.text}`
}

export function renderDownloadResult(result: ExportTranscriptionResponse): string {
  return `Download ${result.format} at ${result.downloadUrl} (expires ${result.expiresAt})`
}

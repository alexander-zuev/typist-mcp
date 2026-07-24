export const TOOL_RATE_LIMITS = {
  search_transcripts: { max: 60, windowMs: 60_000 },
  read_transcript: { max: 30, windowMs: 60_000 },
  download_transcript: { max: 30, windowMs: 60_000 },
} as const

export type ToolName = keyof typeof TOOL_RATE_LIMITS

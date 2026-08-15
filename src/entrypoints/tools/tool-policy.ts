export const TOOL_NAMES = ['search_transcripts', 'read_transcript', 'download_transcript'] as const

export type ToolName = (typeof TOOL_NAMES)[number]

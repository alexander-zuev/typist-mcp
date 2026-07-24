# typist-mcp

Remote MCP server for [Typist](https://iamtypist.dev) — connect your AI agent (Claude, Cursor, ChatGPT, and any MCP client with OAuth support) to your transcript library.

```
https://mcp.iamtypist.dev/mcp
```

## Tools

| Tool | What it does |
| --- | --- |
| `search_transcripts` | Search by title/topic, category, or date range; omit the query to list recent transcripts |
| `read_transcript` | Read transcript content in `txt`, `srt`, or `vtt`, with bounded pagination for agent context windows |
| `download_transcript` | Create a one-hour download URL in `txt`, `srt`, or `vtt` |

Locked transcripts remain discoverable, while read and download access stays limited to the preview available to the account.

Auth is OAuth 2.1 (PKCE + dynamic client registration): sign in with your Typist account and approve transcript read access. Every tool is read-only; agents cannot modify or delete transcripts.

## Architecture

- Cloudflare Worker built on the [Agents SDK](https://developers.cloudflare.com/agents/) (`McpAgent`) + [`workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)
- Transcript data is served over a private service binding to the main Typist worker — this repo contains no data access code

## Boundary

This repo is the deployed source of `mcp.iamtypist.dev`, developed as a submodule of the private Typist monorepo. It is **readable, not standalone-buildable**: `@typist/core` (shared contracts) and the `McpGateway` service binding live in the monorepo. Docs: [iamtypist.dev/docs/mcp](https://iamtypist.dev/docs/mcp).

# typist-mcp

Remote MCP server for [Typist](https://iamtypist.dev) — connect your AI agent (Claude, Cursor, ChatGPT, and any MCP client with OAuth support) to your transcript library.

```
https://mcp.iamtypist.dev/mcp
```

## Tools

| Tool | What it does |
| --- | --- |
| `search_transcripts` | Search your library by title/topic, category, or date range |
| `get_transcript` | Fetch transcript content (txt/srt/vtt), chunked for token-constrained clients, or as a 1-hour download link |

Auth is OAuth 2.1 (PKCE + dynamic client registration) — sign in with your Typist account, approve read access, done. Read-only: agents can never modify or delete your transcripts.

## Architecture

- Cloudflare Worker built on the [Agents SDK](https://developers.cloudflare.com/agents/) (`McpAgent`) + [`workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)
- Transcript data is served over a private service binding to the main Typist worker — this repo contains no data access code

## Boundary

This repo is the deployed source of `mcp.iamtypist.dev`, developed as a submodule of the private Typist monorepo. It is **readable, not standalone-buildable**: `@typist/core` (shared contracts) and the `McpGateway` service binding live in the monorepo. Docs: [iamtypist.dev/docs/mcp](https://iamtypist.dev/docs/mcp).

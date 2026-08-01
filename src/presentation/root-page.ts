/**
 * Landing page for `GET /`. The root path carries no protocol meaning, so it
 * exists purely to orient whoever wandered in: browsers get a page, everything
 * else (curl, agents probing the origin) gets the same facts as plain text.
 *
 * This worker has no CSS pipeline, so the design-system tokens below are
 * inlined copies of the light-theme values from `@typist/ui` stylesheets
 * (Radix slate/indigo). Keep them in sync by hand when the palette moves.
 */

const DOCS_URL = 'https://docs.iamtypist.dev/mcp/'
const CONNECT_URL = 'https://docs.iamtypist.dev/mcp/connect/'

interface Tool {
  name: string
  description: string
}

const TOOLS: readonly Tool[] = [
  { name: 'search_transcripts', description: 'Find transcripts by topic, category, or date' },
  { name: 'read_transcript', description: 'Read the text, paginated for context windows' },
  { name: 'download_transcript', description: 'Get a one-hour txt, srt, or vtt link' },
]

export function rootPageResponse(request: Request, mainAppUrl: string): Response {
  const endpoint = new URL('/mcp', request.url).toString()
  const wantsHtml = request.headers.get('accept')?.includes('text/html') === true

  return wantsHtml
    ? new Response(htmlPage(endpoint, mainAppUrl), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=3600',
        },
      })
    : new Response(textPage(endpoint), {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'public, max-age=3600',
        },
      })
}

function textPage(endpoint: string): string {
  const tools = TOOLS.map((tool) => `  ${tool.name.padEnd(21)} ${tool.description}`).join('\n')
  return `Typist MCP

Your transcript library, inside your agent. Add this endpoint to Claude,
Cursor, ChatGPT, or any MCP client that speaks OAuth:

  ${endpoint}

Tools
${tools}

Auth: OAuth 2.1, PKCE and dynamic client registration. Read-only, always.
Docs: ${DOCS_URL}
`
}

function htmlPage(endpoint: string, mainAppUrl: string): string {
  const tools = TOOLS.map(
    (tool) => `<li><code>${tool.name}</code><span>${tool.description}</span></li>`,
  ).join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Typist MCP</title>
<meta name="description" content="Connect your Typist transcript library to Claude, Cursor, ChatGPT, or any MCP client.">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@900&display=swap">
<style>
  :root {
    color-scheme: light;
    --slate-1: #fcfcfd; --slate-2: #f9f9fb; --slate-3: #f0f0f3; --slate-4: #e8e8ec;
    --slate-6: #d9d9e0; --slate-11: #60646c; --slate-12: #1c2024;
    --indigo-3: #edf2fe; --indigo-9: #3e63dd; --indigo-10: #3358d4; --indigo-11: #3a5bc7;

    --background: var(--slate-2);
    --surface: var(--slate-1);
    --muted: var(--slate-3);
    --foreground: var(--slate-12);
    --muted-foreground: var(--slate-11);
    --border: var(--slate-6);
    --accent: var(--indigo-9);
    --accent-hover: var(--indigo-10);
    --accent-muted: var(--indigo-3);
    --accent-muted-foreground: var(--indigo-11);

    --radius-sm: 3px; --radius-md: 4.5px; --radius-lg: 6px; --radius-xl: 9px; --radius-2xl: 12px;

    --font-text: 'Inter', system-ui, sans-serif;
    --font-code: 'JetBrains Mono', 'SF Mono', Consolas, 'Liberation Mono', monospace;
    --font-brand: 'Outfit', system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh; padding: 2rem 1.25rem;
    display: grid; place-items: center;
    background: var(--background); color: var(--foreground);
    font-family: var(--font-text); font-size: 15px; line-height: 1.5;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  .card {
    width: 100%; max-width: 30rem; padding: 2rem;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-2xl); box-shadow: 0 1px 2px rgba(28, 32, 36, 0.04);
  }
  header { display: flex; align-items: center; gap: 0.625rem; margin-bottom: 1.75rem; }
  .wordmark {
    font-family: var(--font-brand); font-weight: 900; font-size: 1rem;
    letter-spacing: -0.03em; line-height: 1;
  }
  .caret {
    display: inline-block; width: 2px; height: 0.9em; margin-left: 1px;
    background: var(--accent); vertical-align: baseline;
    animation: blink 1.2s step-end infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .caret { animation: none; } }
  .badge {
    font-family: var(--font-code); font-size: 0.6875rem; font-weight: 500;
    letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--accent-muted-foreground); background: var(--accent-muted);
    border-radius: var(--radius-sm); padding: 0.1875rem 0.375rem; line-height: 1;
  }
  h1 { font-size: 1.375rem; font-weight: 600; letter-spacing: -0.03em; margin: 0 0 0.5rem; }
  .lede { margin: 0 0 1.5rem; color: var(--muted-foreground); }
  .label {
    font-size: 0.75rem; font-weight: 500; color: var(--muted-foreground);
    letter-spacing: 0.02em; margin: 0 0 0.5rem;
  }
  .endpoint {
    display: flex; align-items: stretch; gap: 0.5rem;
    background: var(--muted); border-radius: var(--radius-lg); padding: 0.5rem 0.5rem 0.5rem 0.75rem;
    margin-bottom: 1.75rem;
  }
  .endpoint code {
    flex: 1; min-width: 0; align-self: center;
    font-family: var(--font-code); font-size: 0.8125rem; color: var(--foreground);
    overflow-x: auto; white-space: nowrap; scrollbar-width: none;
  }
  .endpoint code::-webkit-scrollbar { display: none; }
  .copy {
    flex: none; font: inherit; font-size: 0.75rem; font-weight: 500;
    color: var(--muted-foreground); background: var(--surface);
    border: 1px solid var(--border); border-radius: var(--radius-md);
    padding: 0.25rem 0.625rem; cursor: pointer;
  }
  .copy:hover { color: var(--foreground); background: var(--slate-4); }
  ul { list-style: none; padding: 0; margin: 0 0 1.25rem; }
  li { padding: 0.625rem 0; border-top: 1px solid var(--border); }
  li code {
    display: block; font-family: var(--font-code); font-size: 0.8125rem;
    color: var(--foreground); margin-bottom: 0.125rem;
  }
  li span { font-size: 0.8125rem; color: var(--muted-foreground); }
  footer {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1.25rem;
    padding-top: 1.25rem; border-top: 1px solid var(--border); font-size: 0.8125rem;
  }
  footer a { color: var(--accent); text-decoration: none; font-weight: 500; }
  footer a:hover { color: var(--accent-hover); text-decoration: underline; }
</style>
</head>
<body>
<main class="card">
  <header>
    <span class="wordmark">typist<span class="caret"></span></span>
    <span class="badge">MCP</span>
  </header>

  <h1>Your transcripts, inside your agent</h1>
  <p class="lede">Add this endpoint to Claude, Cursor, ChatGPT, or any MCP client that speaks OAuth. Sign in once and your library is searchable from the chat.</p>

  <p class="label">Server endpoint</p>
  <div class="endpoint">
    <code id="endpoint">${endpoint}</code>
    <button class="copy" type="button" data-copy="${endpoint}">Copy</button>
  </div>

  <p class="label">Tools</p>
  <ul>${tools}</ul>

  <footer>
    <a href="${CONNECT_URL}">Connect a client</a>
    <a href="${DOCS_URL}">Docs</a>
    <a href="${mainAppUrl}">iamtypist.dev</a>
  </footer>
</main>
<script>
  document.querySelector('.copy').addEventListener('click', async (event) => {
    const button = event.currentTarget
    try {
      await navigator.clipboard.writeText(button.dataset.copy)
      button.textContent = 'Copied'
      setTimeout(() => { button.textContent = 'Copy' }, 1600)
    } catch {
      const range = document.createRange()
      range.selectNodeContents(document.getElementById('endpoint'))
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    }
  })
</script>
</body>
</html>
`
}

import { NextRequest, NextResponse } from 'next/server'

const OWNER = 'COBRAskulls'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN

// Fetch a file from GitHub
async function fetchFile(repo: string, path: string, branch: string): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${repo}/contents/${path}?ref=${branch}`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    }
  )
  if (!res.ok) return null
  const data = await res.json()
  if (data.encoding === 'base64') {
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8')
  }
  return null
}

// Get default branch
async function getDefaultBranch(repo: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${repo}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
  })
  const d = await res.json()
  return d.default_branch || 'main'
}

// Given a route like /dashboard, find the source file path
async function findPageFile(repo: string, route: string, branch: string): Promise<string | null> {
  const segment = route === '/' ? '' : route.replace(/^\//, '')

  // Try App Router paths first
  const appCandidates = [
    `src/app/${segment}/page.tsx`,
    `src/app/${segment}/page.jsx`,
    `src/app/${segment}/page.js`,
    `app/${segment}/page.tsx`,
    `app/${segment}/page.jsx`,
    `app/${segment}/page.js`,
  ]
  // Home page
  if (!segment) {
    appCandidates.unshift('src/app/page.tsx', 'src/app/page.jsx', 'app/page.tsx', 'app/page.jsx')
  }

  // Pages Router
  const pagesCandidates = [
    `src/pages/${segment || 'index'}.tsx`,
    `src/pages/${segment || 'index'}.jsx`,
    `src/pages/${segment || 'index'}.js`,
    `pages/${segment || 'index'}.tsx`,
    `pages/${segment || 'index'}.jsx`,
    `pages/${segment || 'index'}.js`,
  ]

  const all = [...appCandidates, ...pagesCandidates]

  for (const candidate of all) {
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${repo}/contents/${candidate}?ref=${branch}`,
      {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
      }
    )
    if (res.ok) return candidate
  }
  return null
}

// Very simple JSX → HTML converter
// Handles the common cases: converts className→class, removes TS types, self-closing tags, etc.
function jsxToHtml(source: string): string {
  // Extract the return block from the default export function
  // Find the last `return (` or `return(` in the file
  let jsx = ''

  const returnMatch = source.match(/return\s*\(\s*([\s\S]*?)\s*\)\s*(?:}|$)/)
  if (returnMatch) {
    jsx = returnMatch[1]
  } else {
    // Fallback: grab everything after `return `
    const idx = source.lastIndexOf('return ')
    if (idx !== -1) jsx = source.slice(idx + 7)
  }

  if (!jsx.trim()) {
    jsx = '<div>Could not parse source</div>'
  }

  // Strip TypeScript type annotations from JSX attributes: prop={value as Type}
  jsx = jsx.replace(/\s+as\s+[A-Z][A-Za-z<>[\],\s|&]*(?=[}\s])/g, '')

  // Convert className to class
  jsx = jsx.replace(/className=/g, 'class=')

  // Remove self-closing React fragments and convert to divs
  jsx = jsx.replace(/<>/g, '<div class="__fragment">').replace(/<\/>/g, '</div>')

  // Remove common React-specific things
  jsx = jsx.replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // JSX comments
  jsx = jsx.replace(/\bkey=\{[^}]*\}/g, '')
  jsx = jsx.replace(/\bref=\{[^}]*\}/g, '')
  jsx = jsx.replace(/\bonClick=\{[^}]*\}/g, '')
  jsx = jsx.replace(/\bonChange=\{[^}]*\}/g, '')
  jsx = jsx.replace(/\bonSubmit=\{[^}]*\}/g, '')
  jsx = jsx.replace(/\bonKeyDown=\{[^}]*\}/g, '')
  jsx = jsx.replace(/\bdisabled=\{[^}]*\}/g, '')

  // Strip dynamic expressions in attributes {expr} → placeholders
  jsx = jsx.replace(/=\{`([^`]*)`\}/g, '="$1"') // template literals
  jsx = jsx.replace(/=\{['"]([^'"]*)['"]\}/g, '="$1"') // string expressions

  // Convert self-closing custom components to divs
  jsx = jsx.replace(/<([A-Z][A-Za-z]*)([^>]*?)\/>/g, '<div class="component-$1"$2></div>')
  jsx = jsx.replace(/<([A-Z][A-Za-z]*)([^>]*)>([\s\S]*?)<\/\1>/g, '<div class="component-$1"$2>$3</div>')

  // Remove remaining JS expressions in JSX but preserve readable text
  jsx = jsx.replace(/\{[^}]{0,200}\}/g, '')

  // Clean up extra whitespace
  jsx = jsx.replace(/\n\s*\n\s*\n/g, '\n\n')

  return jsx
}

const CANVAS_INJECTION = `
<script>
(function() {
  var style = document.createElement('style');
  style.textContent = [
    '* { box-sizing: border-box; }',
    '.canvas-hover { outline: 2px solid #3b82f6 !important; outline-offset: 2px; cursor: crosshair !important; }',
    '.canvas-selected { outline: 2px solid #c9a84c !important; outline-offset: 2px; }',
    '.component-badge { display: inline-block; background: #7c3aed22; border: 1px dashed #7c3aed55; border-radius: 4px; padding: 2px 6px; font-size: 10px; color: #7c3aed; margin: 2px; }',
    '.__fragment { display: contents; }'
  ].join('');
  document.head.appendChild(style);

  var hovered = null;
  document.addEventListener('mouseover', function(e) {
    if (hovered) hovered.classList.remove('canvas-hover');
    hovered = e.target;
    if (hovered) hovered.classList.add('canvas-hover');
  }, true);
  document.addEventListener('mouseout', function(e) {
    if (e.target && e.target.classList) e.target.classList.remove('canvas-hover');
  }, true);
  document.addEventListener('click', function(e) {
    e.preventDefault(); e.stopPropagation();
    var el = e.target;
    document.querySelectorAll('.canvas-selected').forEach(function(x){ x.classList.remove('canvas-selected'); });
    el.classList.add('canvas-selected');
    var target = window.parent !== window ? window.parent : window.top;
    if (target) {
      target.postMessage({
        type: 'ELEMENT_SELECTED',
        element: {
          tag: el.tagName.toLowerCase(),
          classes: (el.className || '').toString().replace('canvas-selected','').replace('canvas-hover','').trim(),
          text: (el.innerText || el.textContent || '').trim().slice(0, 200),
          id: el.id || ''
        }
      }, '*');
    }
  }, true);
  document.addEventListener('click', function(e) { e.preventDefault(); }, false);
})();
</script>
`

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get('repo')
  const route = req.nextUrl.searchParams.get('route') || '/'

  if (!repo) return new NextResponse('repo required', { status: 400 })

  try {
    const branch = await getDefaultBranch(repo)
    const filePath = await findPageFile(repo, route, branch)

    if (!filePath) {
      return new NextResponse(
        `<html><body style="background:#0f1b35;color:#4a5568;font-family:monospace;padding:2rem;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center"><div style="font-size:2rem;margin-bottom:1rem">📄</div>
          <div style="color:#718096">No page file found for route <code style="color:#a0aec0">${route}</code></div></div>
        </body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      )
    }

    const source = await fetchFile(repo, filePath, branch)
    if (!source) {
      return new NextResponse('Could not fetch file', { status: 500 })
    }

    const bodyHtml = jsxToHtml(source)

    // Try to extract any Tailwind CDN or find if there's a globals.css-style background
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${repo} — ${route}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { margin: 0; background: #fff; }
    [class*="component-"] { display: block; }
    .__fragment { display: contents; }
    .canvas-source-badge {
      position: fixed; top: 8px; right: 8px; z-index: 9999;
      background: #1a1a2e; color: #7c3aed; font-family: monospace;
      font-size: 10px; padding: 4px 10px; border-radius: 6px;
      border: 1px solid #7c3aed44; pointer-events: none;
    }
  </style>
</head>
<body>
  <div class="canvas-source-badge">📄 source: ${filePath}</div>
  ${bodyHtml}
  ${CANVAS_INJECTION}
</body>
</html>`

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'ALLOWALL',
        'Content-Security-Policy': '',
      }
    })
  } catch (e: any) {
    return new NextResponse(`Error: ${e.message}`, { status: 500 })
  }
}

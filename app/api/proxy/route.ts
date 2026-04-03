import { NextRequest, NextResponse } from 'next/server'

const INJECTION = `
<script>
(function() {
  var style = document.createElement('style');
  style.textContent = [
    '.canvas-hover { outline: 2px solid #3b82f6 !important; outline-offset: 2px; cursor: crosshair !important; }',
    '.canvas-selected { outline: 2px solid #c9a84c !important; outline-offset: 2px; }'
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
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    document.querySelectorAll('.canvas-selected').forEach(function(x){ x.classList.remove('canvas-selected'); });
    el.classList.add('canvas-selected');
    var target = window.parent !== window ? window.parent : window.top;
    if (target) {
      target.postMessage({
        type: 'ELEMENT_SELECTED',
        element: {
          tag: el.tagName.toLowerCase(),
          classes: (el.className || '').toString().replace('canvas-selected','').trim(),
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

function authGatedPage(url: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f1b35; color: #a0aec0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh; }
  .card { text-align: center; padding: 2rem; max-width: 380px; }
  .icon { font-size: 2.5rem; margin-bottom: 1rem; }
  h2 { color: #e2e8f0; font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; }
  p { font-size: 0.8rem; color: #4a5568; line-height: 1.5; margin-bottom: 1.5rem; }
  a { display: inline-block; background: linear-gradient(135deg, #7c3aed, #4f46e5);
      color: white; font-size: 0.8rem; font-weight: 600; padding: 0.6rem 1.4rem;
      border-radius: 8px; text-decoration: none; }
  a:hover { opacity: 0.85; }
  .note { margin-top: 1rem; font-size: 0.72rem; color: #2d3748; }
</style></head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h2>Login required</h2>
    <p>This app is behind authentication. Canvas can't preview it directly — open it in a new tab, log in, then use the right panel to describe changes and Rosie will edit the code.</p>
    <a href="${url}" target="_blank" rel="noopener">Open app ↗</a>
    <div class="note">Canvas will still edit the code for any page — just describe what needs changing.</div>
  </div>
</body>
</html>`
}

function iframeBlockedPage(url: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f1b35; color: #a0aec0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh; }
  .card { text-align: center; padding: 2rem; max-width: 380px; }
  .icon { font-size: 2.5rem; margin-bottom: 1rem; }
  h2 { color: #e2e8f0; font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; }
  p { font-size: 0.8rem; color: #4a5568; line-height: 1.5; margin-bottom: 1.5rem; }
  a { display: inline-block; background: linear-gradient(135deg, #7c3aed, #4f46e5);
      color: white; font-size: 0.8rem; font-weight: 600; padding: 0.6rem 1.4rem;
      border-radius: 8px; text-decoration: none; }
  a:hover { opacity: 0.85; }
  .note { margin-top: 1rem; font-size: 0.72rem; color: #2d3748; }
</style></head>
<body>
  <div class="card">
    <div class="icon">🛡️</div>
    <h2>Preview blocked</h2>
    <p>This site blocks being loaded inside a frame. You can still edit it — open it in a new tab to reference it, then describe changes in the right panel.</p>
    <a href="${url}" target="_blank" rel="noopener">Open site ↗</a>
    <div class="note">Rosie edits source code directly — preview blocking doesn't stop edits.</div>
  </div>
</body>
</html>`
}

function isAuthGated(html: string, finalUrl: string): boolean {
  const lower = finalUrl.toLowerCase()
  if (lower.includes('/login') || lower.includes('/signin') || lower.includes('/auth')) return true
  // Check HTML content for common login page signals
  const bodyLower = html.toLowerCase()
  const loginSignals = ['type="password"', "type='password'", 'sign in', 'log in', 'login form']
  const matches = loginSignals.filter(s => bodyLower.includes(s))
  return matches.length >= 2
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    })

    // Check if we were redirected to a login page
    const finalUrl = res.url || url

    // Check for X-Frame-Options / CSP that would block iframe
    const xfo = res.headers.get('x-frame-options') || ''
    const csp = res.headers.get('content-security-policy') || ''
    const frameBlocked = /deny|sameorigin/i.test(xfo) || /frame-ancestors\s+'none'/i.test(csp)

    let html = await res.text()

    // Detect auth gate
    if (isAuthGated(html, finalUrl)) {
      return new NextResponse(authGatedPage(url), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }

    // Detect iframe block (server header level)
    if (frameBlocked) {
      return new NextResponse(iframeBlockedPage(url), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }

    // Rewrite relative URLs to absolute so assets load
    const baseUrl = new URL(url)
    const base = `${baseUrl.protocol}//${baseUrl.host}`

    html = html
      .replace(/href="\/(?!\/)/g, `href="${base}/`)
      .replace(/src="\/(?!\/)/g, `src="${base}/`)
      .replace(/href='\/(?!\/)/g, `href='${base}/`)
      .replace(/src='\/(?!\/)/g, `src='${base}/`)
      .replace(/url\(\/(?!\/)/g, `url(${base}/`)

    // Strip X-Frame-Options and CSP meta tags that would block the iframe
    html = html.replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, '')
    html = html.replace(/<meta[^>]+content-security-policy[^>]*>/gi, '')

    // Inject canvas script
    if (html.includes('</body>')) {
      html = html.replace('</body>', INJECTION + '</body>')
    } else if (html.includes('</html>')) {
      html = html.replace('</html>', INJECTION + '</html>')
    } else {
      html += INJECTION
    }

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'ALLOWALL',
        'Content-Security-Policy': '',
      }
    })
  } catch (e: any) {
    return new NextResponse(iframeBlockedPage(url), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    })
  }
}

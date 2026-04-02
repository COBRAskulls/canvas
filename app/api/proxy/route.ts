import { NextRequest, NextResponse } from 'next/server'

const INJECTION = `
<script>
(function() {
  // Inject highlighting styles
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
    window.parent.postMessage({
      type: 'ELEMENT_SELECTED',
      element: {
        tag: el.tagName.toLowerCase(),
        classes: (el.className || '').toString().replace('canvas-selected','').trim(),
        text: (el.innerText || el.textContent || '').trim().slice(0, 200),
        id: el.id || ''
      }
    }, '*');
  }, true);

  // Prevent link navigation
  document.addEventListener('click', function(e) { e.preventDefault(); }, false);
})();
</script>
`

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    let html = await res.text()

    // Rewrite relative URLs to absolute so assets load
    const baseUrl = new URL(url)
    const base = `${baseUrl.protocol}//${baseUrl.host}`

    html = html
      .replace(/href="\/(?!\/)/g, `href="${base}/`)
      .replace(/src="\/(?!\/)/g, `src="${base}/`)
      .replace(/href='\/(?!\/)/g, `href='${base}/`)
      .replace(/src='\/(?!\/)/g, `src='${base}/`)
      .replace(/url\(\/(?!\/)/g, `url(${base}/`)

    // Inject our script just before </body>
    html = html.replace('</body>', INJECTION + '</body>')

    // If no </body>, append at end
    if (!html.includes('</body>')) {
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
    return new NextResponse(`<html><body style="background:#0a0a0a;color:#999;font-family:monospace;padding:2rem;"><p>Could not load: ${url}</p><p style="color:#555">${e.message}</p></body></html>`, {
      headers: { 'Content-Type': 'text/html' }
    })
  }
}

import { NextRequest, NextResponse } from 'next/server'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const OWNER = 'COBRAskulls'

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get('repo')
  if (!repo) return NextResponse.json({ error: 'repo required' }, { status: 400 })

  try {
    // Get the default branch first
    const repoRes = await fetch(`https://api.github.com/repos/${OWNER}/${repo}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
      next: { revalidate: 60 },
    })
    if (!repoRes.ok) throw new Error('Repo not found')
    const repoData = await repoRes.json()
    const branch = repoData.default_branch || 'main'

    // Fetch full file tree recursively
    const treeRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${repo}/git/trees/${branch}?recursive=1`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
        },
        next: { revalidate: 60 },
      }
    )
    if (!treeRes.ok) throw new Error('Tree fetch failed')
    const treeData = await treeRes.json()

    const files: string[] = (treeData.tree || [])
      .filter((f: { type: string; path: string }) => f.type === 'blob')
      .map((f: { path: string }) => f.path)

    const routes = new Set<string>()

    for (const file of files) {
      // Next.js App Router: app/**/page.tsx|jsx|js
      const appMatch = file.match(/^(?:src\/)?app(\/.*)?\/page\.[tj]sx?$/)
      if (appMatch) {
        const segment = appMatch[1] || ''
        // Strip route groups (parentheses) and parallel routes (@)
        const route = segment
          .split('/')
          .filter(p => p && !p.startsWith('(') && !p.startsWith('@'))
          .join('/')
        routes.add(route ? `/${route}` : '/')
        continue
      }

      // Next.js Pages Router: pages/**/*.tsx|jsx|js (exclude _app, _document, api/)
      const pagesMatch = file.match(/^(?:src\/)?pages\/(.*)\.[tj]sx?$/)
      if (pagesMatch) {
        const segment = pagesMatch[1]
        if (segment.startsWith('_') || segment.startsWith('api/')) continue
        const route = segment === 'index' ? '/' : `/${segment.replace(/\/index$/, '')}`
        routes.add(route)
      }
    }

    const sorted = Array.from(routes).sort((a, b) => {
      if (a === '/') return -1
      if (b === '/') return 1
      return a.localeCompare(b)
    })

    return NextResponse.json({ pages: sorted })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

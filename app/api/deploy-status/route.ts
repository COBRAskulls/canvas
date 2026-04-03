import { NextRequest, NextResponse } from 'next/server'

// Poll GitHub commits to detect when a push has landed
// This is simpler and more reliable than polling Vercel
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const repo = searchParams.get('repo')
  const expectedCommit = searchParams.get('commit')

  if (!repo) return NextResponse.json({ error: 'No repo' }, { status: 400 })

  try {
    const res = await fetch(
      `https://api.github.com/repos/COBRAskulls/${repo}/commits?per_page=1`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
        },
        cache: 'no-store',
      }
    )
    const commits = await res.json()
    const latest = commits[0]

    if (!latest) return NextResponse.json({ found: false })

    const latestSha = latest.sha
    const shortSha = latestSha?.slice(0, 7)

    // If we have an expected commit, check if it landed
    if (expectedCommit) {
      const matched = latestSha?.startsWith(expectedCommit) || shortSha === expectedCommit
      return NextResponse.json({
        found: matched,
        latestCommit: shortSha,
        message: latest.commit?.message?.slice(0, 80),
      })
    }

    return NextResponse.json({
      found: true,
      latestCommit: shortSha,
      message: latest.commit?.message?.slice(0, 80),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

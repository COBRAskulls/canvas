import { NextResponse } from 'next/server'

const KNOWN_URLS: Record<string, string> = {
  'cobraspeer-site': 'https://cobraspeer.com',
  'cobraspeer': 'https://cobraspeer.com',
  'pm-app': 'https://pm.cobraspeer.com',
  'canvas-build': 'https://editor.cobraspeer.com',
}

export async function GET() {
  // Fetch GitHub repos and all Vercel projects in parallel (2 requests total, not N)
  const [repoRes, vercelRes] = await Promise.all([
    fetch('https://api.github.com/users/COBRAskulls/repos?per_page=100&sort=updated', {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
      next: { revalidate: 60 }
    }),
    fetch('https://api.vercel.com/v9/projects?limit=100', {
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
      next: { revalidate: 60 }
    })
  ])

  const [repos, vercelData] = await Promise.all([repoRes.json(), vercelRes.json()])
  const vercelProjects: any[] = vercelData.projects || []

  // Build a quick lookup: vercel project name → { id, domains }
  const vercelMap: Record<string, { id: string; liveUrl: string | null }> = {}
  for (const vp of vercelProjects) {
    // Use latestDeployments URL as fallback — no extra per-project API calls
    const latestUrl = vp.latestDeployments?.[0]?.url
    vercelMap[vp.name] = {
      id: vp.id,
      liveUrl: latestUrl ? `https://${latestUrl}` : null,
    }
  }

  const mapped = repos.map((r: any) => {
    // Known URL takes priority
    const knownUrl = KNOWN_URLS[r.name]

    // Try exact vercel match
    let vercelEntry = vercelMap[r.name]
    if (!vercelEntry) {
      const key = Object.keys(vercelMap).find(k => k.includes(r.name) || r.name.includes(k))
      if (key) vercelEntry = vercelMap[key]
    }

    const liveUrl = knownUrl || vercelEntry?.liveUrl || null

    return {
      id: r.id,
      name: r.name,
      description: r.description,
      url: r.html_url,
      updatedAt: r.updated_at,
      liveUrl,
      vercelProjectId: vercelEntry?.id || null,
    }
  })

  return NextResponse.json(mapped)
}

import { NextResponse } from 'next/server'

// Known live URLs for COBRAskulls projects — fallback mapping
const KNOWN_URLS: Record<string, string> = {
  'cobraspeer-site': 'https://cobraspeer.com',
  'cobraspeer': 'https://cobraspeer.com',
  'pm-app': 'https://pm.cobraspeer.com',
  'canvas-build': 'https://canvas-build-six.vercel.app',
}

export async function GET() {
  // Fetch GitHub repos
  const repoRes = await fetch('https://api.github.com/users/COBRAskulls/repos?per_page=100&sort=updated', {
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    },
    next: { revalidate: 60 }
  })
  const repos = await repoRes.json()

  // Fetch all Vercel projects with their domains
  const vercelRes = await fetch('https://api.vercel.com/v9/projects?limit=100', {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    next: { revalidate: 60 }
  })
  const vercelData = await vercelRes.json()
  const vercelProjects = vercelData.projects || []

  // Build a map of Vercel project name -> live URL by checking domains endpoint per project
  // For efficiency, use latestDeployments.url + known custom domain check
  const vercelMap: Record<string, { id: string; liveUrl: string | null }> = {}

  for (const vp of vercelProjects) {
    // Try to get custom domains for this project
    let customDomain: string | null = null
    try {
      const domRes = await fetch(`https://api.vercel.com/v9/projects/${vp.id}/domains`, {
        headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
        next: { revalidate: 300 }
      })
      const domData = await domRes.json()
      const domains: any[] = domData.domains || []
      // Prefer non-vercel.app domain
      const custom = domains.find((d: any) => d.verified && !d.name.includes('.vercel.app'))
      const vercelApp = domains.find((d: any) => d.verified && d.name.includes('.vercel.app'))
      customDomain = custom?.name || vercelApp?.name || null
    } catch (_) {}

    const liveUrl = customDomain
      ? `https://${customDomain}`
      : vp.latestDeployments?.[0]?.url
        ? `https://${vp.latestDeployments[0].url}`
        : null

    vercelMap[vp.name] = { id: vp.id, liveUrl }
  }

  const mapped = repos.map((r: any) => {
    // Look up by exact name first, then partial match
    let vercelEntry = vercelMap[r.name]
    if (!vercelEntry) {
      const key = Object.keys(vercelMap).find(k => k.includes(r.name) || r.name.includes(k))
      if (key) vercelEntry = vercelMap[key]
    }

    // Fall back to known URLs
    const liveUrl = KNOWN_URLS[r.name] || vercelEntry?.liveUrl || null

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

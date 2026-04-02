import { NextResponse } from 'next/server'

export async function GET() {
  const res = await fetch('https://api.github.com/users/COBRAskulls/repos?per_page=100&sort=updated', {
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    },
    next: { revalidate: 60 }
  })
  const repos = await res.json()
  
  // Also get Vercel projects to map repo -> live URL
  const vercelRes = await fetch('https://api.vercel.com/v9/projects?limit=100', {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    next: { revalidate: 60 }
  })
  const vercelData = await vercelRes.json()
  const vercelProjects = vercelData.projects || []

  const mapped = repos.map((r: any) => {
    const vp = vercelProjects.find((p: any) => 
      p.name === r.name || p.name.includes(r.name) || r.name.includes(p.name)
    )
    const domains = vp?.alias || []
    const liveUrl = domains.find((d: any) => !d.includes('vercel.app'))?.domain 
      || domains[0]?.domain
      || (vp ? `https://${vp.name}.vercel.app` : null)

    return {
      id: r.id,
      name: r.name,
      description: r.description,
      url: r.html_url,
      updatedAt: r.updated_at,
      liveUrl: liveUrl ? `https://${liveUrl.replace('https://','')}` : null,
      vercelProjectId: vp?.id || null,
    }
  })

  return NextResponse.json(mapped)
}

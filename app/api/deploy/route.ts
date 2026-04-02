import { NextRequest, NextResponse } from 'next/server'

// Known project IDs for repos without GitHub integration
const VERCEL_PROJECT_MAP: Record<string, string> = {
  'cobraspeer-site': 'prj_U2Hf1GGw6OEsKGXMGw7QleU67LoO',
  'cobraspeer': 'prj_U2Hf1GGw6OEsKGXMGw7QleU67LoO',
}

export async function POST(req: NextRequest) {
  const { repo } = await req.json()
  if (!repo) return NextResponse.json({ error: 'No repo' }, { status: 400 })

  const projectId = VERCEL_PROJECT_MAP[repo]
  if (!projectId) {
    return NextResponse.json({ skipped: true, reason: 'No direct project mapping — Vercel may auto-deploy via GitHub' })
  }

  try {
    // Fetch all files from GitHub repo
    const treeRes = await fetch(`https://api.github.com/repos/COBRAskulls/${repo}/git/trees/main?recursive=1`, {
      headers: { Authorization: `token ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
    })
    const treeData = await treeRes.json()
    const files = (treeData.tree || []).filter((f: any) => f.type === 'blob' && !f.path.startsWith('.'))

    // Build file map for Vercel deployment
    const fileContents: Array<{ file: string; data: string; encoding: string }> = []

    for (const f of files) {
      const blobRes = await fetch(`https://api.github.com/repos/COBRAskulls/${repo}/contents/${f.path}`, {
        headers: { Authorization: `token ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
      })
      const blob = await blobRes.json()
      if (blob.content) {
        fileContents.push({ file: f.path, data: blob.content.replace(/\n/g, ''), encoding: 'base64' })
      }
    }

    // Create Vercel deployment
    const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: repo === 'cobraspeer-site' ? 'cobraspeer' : repo,
        project: projectId,
        files: fileContents,
        target: 'production',
        projectSettings: { outputDirectory: '.' }
      })
    })

    const deployData = await deployRes.json()

    return NextResponse.json({
      deploymentId: deployData.id,
      url: deployData.url,
      state: deployData.readyState || deployData.status,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

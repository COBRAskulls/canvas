import { NextRequest, NextResponse } from 'next/server'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!

export async function POST(req: NextRequest) {
  const { repo, file, content, description } = await req.json()
  if (!repo || !file || !content) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  // Get current SHA
  const fileRes = await fetch(`https://api.github.com/repos/COBRAskulls/${repo}/contents/${file}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
  })
  const fileData = await fileRes.json()
  if (!fileData.sha) return NextResponse.json({ error: 'Could not get current file SHA' }, { status: 500 })

  // Restore previous content
  const pushRes = await fetch(`https://api.github.com/repos/COBRAskulls/${repo}/contents/${file}`, {
    method: 'PUT',
    headers: { Authorization: `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
    body: JSON.stringify({
      message: `Canvas undo: revert "${description}"`,
      content,
      sha: fileData.sha,
    })
  })
  const pushData = await pushRes.json()

  if (!pushData.commit) return NextResponse.json({ error: 'Undo push failed', detail: pushData }, { status: 500 })

  // Trigger redeploy
  const VERCEL_PROJECT_IDS: Record<string, string> = {
    'cobraspeer-site': 'prj_U2Hf1GGw6OEsKGXMGw7QleU67LoO',
    'pm-app': 'prj_FXBoP1P8m6w47Q5THRhN99uEkFyS',
  }
  const projectId = VERCEL_PROJECT_IDS[repo]
  if (projectId) {
    try {
      const restoredContent = Buffer.from(content, 'base64').toString('utf-8')
      const treeRes = await fetch(`https://api.github.com/repos/COBRAskulls/${repo}/git/trees/main?recursive=1`, {
        headers: { Authorization: `token ${GITHUB_TOKEN}` }
      })
      const treeData = await treeRes.json()
      const blobs = (treeData.tree || []).filter((f: any) => f.type === 'blob' && !f.path.startsWith('.git'))
      const files: any[] = []
      for (const f of blobs) {
        if (f.path === file) {
          files.push({ file: f.path, data: content, encoding: 'base64' })
        } else {
          try {
            const b = await fetch(`https://api.github.com/repos/COBRAskulls/${repo}/contents/${f.path}`, {
              headers: { Authorization: `token ${GITHUB_TOKEN}` }
            }).then(r => r.json())
            if (b.content) files.push({ file: f.path, data: b.content.replace(/\n/g, ''), encoding: 'base64' })
          } catch (_) {}
        }
      }
      await fetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repo === 'cobraspeer-site' ? 'cobraspeer' : repo, project: projectId, files, target: 'production', projectSettings: { outputDirectory: '.' } })
      })
    } catch (_) {}
  }

  return NextResponse.json({ success: true, commit: pushData.commit.sha?.slice(0, 7) })
}

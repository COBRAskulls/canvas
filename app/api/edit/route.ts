import { NextRequest, NextResponse } from 'next/server'

async function triggerVercelDeploy(repo: string, projectId: string, vercelToken: string, githubToken: string) {
  // Fetch all repo files from GitHub and push to Vercel
  const treeRes = await fetch(`https://api.github.com/repos/COBRAskulls/${repo}/git/trees/main?recursive=1`, {
    headers: { Authorization: `token ${githubToken}`, Accept: 'application/vnd.github.v3+json' }
  })
  const treeData = await treeRes.json()
  const blobs = (treeData.tree || []).filter((f: any) => f.type === 'blob' && !f.path.startsWith('.git') && !f.path.startsWith('node_modules'))

  const files: Array<{ file: string; data: string; encoding: string }> = []
  for (const f of blobs) {
    try {
      const b = await fetch(`https://api.github.com/repos/COBRAskulls/${repo}/contents/${f.path}`, {
        headers: { Authorization: `token ${githubToken}`, Accept: 'application/vnd.github.v3+json' }
      }).then(r => r.json())
      if (b.content) files.push({ file: f.path, data: b.content.replace(/\n/g, ''), encoding: 'base64' })
    } catch (_) {}
  }

  const projectName = repo === 'cobraspeer-site' ? 'cobraspeer' : repo
  await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: projectName, project: projectId, files, target: 'production', projectSettings: { outputDirectory: '.' } })
  })
}

export async function POST(req: NextRequest) {
  const { repo, element, instruction } = await req.json()

  if (!repo || !instruction) {
    return NextResponse.json({ error: 'Missing repo or instruction' }, { status: 400 })
  }

  const elementDesc = element
    ? [
        `- Element type: ${element.tag}`,
        element.text ? `- Current text: ${element.text}` : null,
        element.classes ? `- CSS classes: ${element.classes.replace('canvas-hover', '').replace('canvas-selected', '').trim()}` : null,
        element.id ? `- Element ID: ${element.id}` : null,
      ].filter(Boolean).join('\n')
    : '- No element selected'

  const message = `In the GitHub repo COBRAskulls/${repo}, find and edit the following element:
${elementDesc}

Instruction: ${instruction}

Search all files in the repo to find where this element lives.
Make the edit directly to the source file and push to GitHub on the main branch.
Reply with the filename you edited, a one-line description of what changed, and the commit SHA.
Reply in this exact JSON format with no other text: {"file": "...", "description": "...", "commit": "..."}`

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_ROSIE_API_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PROXY_API_KEY}`,
      },
      body: JSON.stringify({ message }),
    })

    const data = await res.json()
    const reply = (data.reply || '').trim()

    // Parse Rosie's JSON response
    const jsonMatch = reply.match(/\{[\s\S]*?\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (parsed.commit || parsed.file) {
          // Trigger Vercel deploy for repos without GitHub auto-integration
          const VERCEL_PROJECT_IDS: Record<string, string> = {
            'cobraspeer-site': 'prj_U2Hf1GGw6OEsKGXMGw7QleU67LoO',
            'pm-app': 'prj_FXBoP1P8m6w47Q5THRhN99uEkFyS',
          }
          const projectId = VERCEL_PROJECT_IDS[repo]
          if (projectId && process.env.VERCEL_TOKEN) {
            // Fire-and-forget: fetch files from GitHub and deploy
            triggerVercelDeploy(repo, projectId, process.env.VERCEL_TOKEN, process.env.GITHUB_TOKEN || '').catch(() => {})
          }

          return NextResponse.json({
            success: true,
            file: parsed.file || 'unknown',
            description: parsed.description || instruction,
            commit: parsed.commit || '',
            rosieReply: reply,
          })
        }
      } catch (_) {}
    }

    // Rosie responded but not in JSON format — still show the reply
    return NextResponse.json({
      success: false,
      error: 'Rosie responded but not in the expected format',
      rosieReply: reply,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Request failed' }, { status: 500 })
  }
}

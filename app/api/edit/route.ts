import { NextRequest, NextResponse } from 'next/server'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!
const GITHUB_API = 'https://api.github.com'

// Repos that need manual Vercel deployment (no GitHub auto-integration)
const VERCEL_PROJECT_IDS: Record<string, string> = {
  'cobraspeer-site': 'prj_U2Hf1GGw6OEsKGXMGw7QleU67LoO',
  'pm-app': 'prj_FXBoP1P8m6w47Q5THRhN99uEkFyS',
}

async function triggerDeploy(repo: string, changedFile: string, newContent: string): Promise<string | null> {
  const projectId = VERCEL_PROJECT_IDS[repo]
  if (!projectId) return null

  // Fetch all files from GitHub
  const treeRes = await fetch(`${GITHUB_API}/repos/COBRAskulls/${repo}/git/trees/main?recursive=1`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
  })
  const treeData = await treeRes.json()
  const blobs = (treeData.tree || []).filter((f: any) => f.type === 'blob' && !f.path.startsWith('.git'))

  const files: Array<{ file: string; data: string; encoding: string }> = []

  for (const f of blobs) {
    if (f.path === changedFile) {
      // Use our already-modified content
      files.push({ file: f.path, data: Buffer.from(newContent).toString('base64'), encoding: 'base64' })
    } else {
      try {
        const blobRes = await fetch(`${GITHUB_API}/repos/COBRAskulls/${repo}/contents/${f.path}`, {
          headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
        })
        const blob = await blobRes.json()
        if (blob.content) files.push({ file: f.path, data: blob.content.replace(/\n/g, ''), encoding: 'base64' })
      } catch (_) {}
    }
  }

  const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: repo === 'cobraspeer-site' ? 'cobraspeer' : repo,
      project: projectId,
      files,
      target: 'production',
      projectSettings: { outputDirectory: '.' }
    })
  })
  const dep = await deployRes.json()
  return dep.id || null
}

async function ghGet(path: string) {
  const r = await fetch(`${GITHUB_API}${path}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
  })
  return r.json()
}

async function ghPut(path: string, body: object) {
  const r = await fetch(`${GITHUB_API}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body)
  })
  return r.json()
}

async function searchInFile(content: string, searchText: string): Promise<boolean> {
  return content.toLowerCase().includes(searchText.toLowerCase())
}

export async function POST(req: NextRequest) {
  const { repo, element, instruction } = await req.json()
  
  if (!repo || !instruction) {
    return NextResponse.json({ error: 'Missing repo or instruction' }, { status: 400 })
  }

  // Step 1: Ask Rosie to figure out the exact edit (what to find/replace)
  const rosiePrompt = `You are a code editor. I need you to make an edit to the ${repo} GitHub repo.

Selected element: ${element ? `<${element.tag}> with class "${element.classes?.replace('canvas-hover','').replace('canvas-selected','').trim()}" containing text "${element.text}"` : 'unknown element'}

Instruction: ${instruction}

Respond with ONLY a JSON object in this exact format, no other text:
{
  "file": "index.html",
  "find": "exact text to find in the file",
  "replace": "exact replacement text",
  "description": "one line describing what changed"
}

The file is most likely index.html. The find text should be the exact HTML including the element tag and content as it appears in the source.`

  const rosieRes = await fetch(`${process.env.NEXT_PUBLIC_ROSIE_API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.PROXY_API_KEY}` },
    body: JSON.stringify({ message: rosiePrompt })
  })
  const rosieData = await rosieRes.json()
  const reply = rosieData.reply || ''

  // Parse the JSON from Rosie's response
  let editPlan: { file: string; find: string; replace: string; description: string } | null = null
  try {
    const jsonMatch = reply.match(/\{[\s\S]*\}/)
    if (jsonMatch) editPlan = JSON.parse(jsonMatch[0])
  } catch {
    return NextResponse.json({ 
      error: 'Could not parse edit plan from Rosie',
      rosieReply: reply 
    }, { status: 500 })
  }

  if (!editPlan) {
    return NextResponse.json({ error: 'No edit plan returned', rosieReply: reply }, { status: 500 })
  }

  // Step 2: Fetch the file from GitHub
  const fileData = await ghGet(`/repos/COBRAskulls/${repo}/contents/${editPlan.file}`)
  if (!fileData.content) {
    return NextResponse.json({ error: `Could not fetch ${editPlan.file} from GitHub` }, { status: 500 })
  }

  const originalContent = Buffer.from(fileData.content, 'base64').toString('utf-8')

  // Step 3: Apply the edit
  if (!originalContent.includes(editPlan.find)) {
    // Try case-insensitive search to give better error
    return NextResponse.json({ 
      error: `Could not find the text to replace. Looking for: "${editPlan.find.slice(0,100)}"`,
      rosieReply: reply
    }, { status: 422 })
  }

  const newContent = originalContent.replace(editPlan.find, editPlan.replace)

  // Step 4: Push to GitHub
  const pushResult = await ghPut(`/repos/COBRAskulls/${repo}/contents/${editPlan.file}`, {
    message: `Canvas edit: ${editPlan.description}`,
    content: Buffer.from(newContent).toString('base64'),
    sha: fileData.sha,
  })

  if (pushResult.commit) {
    // Trigger Vercel deploy from the updated GitHub files
    let vercelProjectId: string | null = null
    try {
      vercelProjectId = await triggerDeploy(repo, editPlan.file, newContent)
    } catch (_) {}

    return NextResponse.json({ 
      success: true, 
      description: editPlan.description,
      commit: pushResult.commit.sha?.slice(0, 7),
      file: editPlan.file,
      vercelProjectId,
      // Include undo info
      undo: {
        repo,
        file: editPlan.file,
        content: Buffer.from(originalContent).toString('base64'),
        sha: pushResult.content?.sha, // sha of the new file for next update
        description: editPlan.description,
      }
    })
  }

  return NextResponse.json({ error: 'Push failed', detail: pushResult }, { status: 500 })
}

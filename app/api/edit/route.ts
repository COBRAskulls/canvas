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

  // Step 1: Find the file and locate the element using its known text
  // We search for the element's current text in the source files — no need to ask Rosie
  const targetFiles = ['index.html', 'pages/index.js', 'app/page.tsx', 'app/page.jsx']
  let fileData: any = null
  let chosenFile = 'index.html'

  for (const f of targetFiles) {
    const fd = await ghGet(`/repos/COBRAskulls/${repo}/contents/${f}`)
    if (fd.content) { fileData = fd; chosenFile = f; break }
  }

  if (!fileData?.content) {
    return NextResponse.json({ error: 'Could not find source file in GitHub repo' }, { status: 500 })
  }

  const originalContent = Buffer.from(fileData.content, 'base64').toString('utf-8')

  // Step 2: Determine what to change using element context + instruction
  // Strategy: find the element's current text in the file, then apply the instruction
  const elementText = element?.text?.trim() || ''
  const elementClasses = element?.classes?.replace('canvas-hover','').replace('canvas-selected','').trim() || ''
  const elementTag = element?.tag || ''

  let editPlan: { find: string; replace: string; description: string } | null = null

  // Try to find the element in the file by its text content
  // Note: innerText may be CSS-transformed (e.g. uppercase via text-transform)
  // So try exact match first, then case-insensitive
  const lowerText = elementText.toLowerCase()
  const lines = originalContent.split('\n')

  const findLineIndex = () => {
    // Exact match first
    let idx = lines.findIndex(l => l.includes(elementText))
    if (idx >= 0) return idx
    // Case-insensitive match (handles CSS text-transform: uppercase)
    idx = lines.findIndex(l => l.toLowerCase().includes(lowerText))
    if (idx >= 0) return idx
    // Try matching by class name if we have one
    if (elementClasses) {
      const classFragments = elementClasses.split(' ').filter(Boolean)
      idx = lines.findIndex(l => classFragments.some((c: string) => l.includes(c)))
      if (idx >= 0) return idx
    }
    return -1
  }

  if (elementText) {
    const lineIdx = findLineIndex()
    
    if (lineIdx >= 0) {
      const line = lines[lineIdx]
      // Interpret the instruction to figure out what the replacement should be
      // For simple text changes, extract the new text from the instruction
      let newText = elementText
      
      // Parse instruction for common patterns
      const changeToMatch = instruction.match(/(?:change|update|make|set|rename).*?(?:to|as|be)\s+["']?(.+?)["']?\s*$/i)
      const removeMatch = instruction.match(/(?:remove|delete|get rid of)\s+["']?(.+?)["']?/i)
      const addMatch = instruction.match(/(?:add|append|prepend|insert)\s+["']?(.+?)["']?/i)
      
      if (removeMatch) {
        // Remove a specific word/phrase from the text
        const toRemove = removeMatch[1].trim()
        newText = elementText.replace(new RegExp(toRemove, 'gi'), '').replace(/\s+/g, ' ').trim()
      } else if (changeToMatch) {
        newText = changeToMatch[1].trim()
      } else {
        // Fall through to Rosie for complex instructions — but get raw JSON back via a special prompt
        // Ask Rosie but force it to only return the replacement text
        const rosieRes = await fetch(`${process.env.NEXT_PUBLIC_ROSIE_API_URL}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.PROXY_API_KEY}` },
          body: JSON.stringify({
            message: `The current text of an element is: "${elementText}"\nThe instruction is: "${instruction}"\nReply with ONLY the new text value, nothing else. No quotes, no explanation.`
          })
        })
        const rd = await rosieRes.json()
        const raw = (rd.reply || '').trim()
        // Strip surrounding quotes if any
        newText = raw.replace(/^["']|["']$/g, '').trim() || elementText
      }

      // Replace in the line — try exact first, then case-insensitive
      let newLine: string
      let actualOldText = elementText
      if (line.includes(elementText)) {
        newLine = line.replace(elementText, newText)
      } else {
        // Case-insensitive replace — find the actual text in the line
        const regex = new RegExp(elementText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        const match = line.match(regex)
        if (match) {
          actualOldText = match[0]
          newLine = line.replace(regex, newText)
        } else {
          newLine = line // fallback, shouldn't reach
        }
      }
      editPlan = {
        find: line,
        replace: newLine,
        description: `Changed "${actualOldText}" to "${newText}"`
      }
    }
  }

  if (!editPlan) {
    return NextResponse.json({
      error: `Could not locate element with text "${elementText.slice(0,80)}" in ${chosenFile}. Try selecting a more specific element.`
    }, { status: 422 })
  }

  // Step 3: Apply the edit
  if (!originalContent.includes(editPlan.find)) {
    return NextResponse.json({ 
      error: `Could not find the exact line to replace in ${chosenFile}`
    }, { status: 422 })
  }

  const newContent = originalContent.replace(editPlan.find, editPlan.replace)

  // Step 4: Push to GitHub
  const pushResult = await ghPut(`/repos/COBRAskulls/${repo}/contents/${chosenFile}`, {
    message: `Canvas edit: ${editPlan.description}`,
    content: Buffer.from(newContent).toString('base64'),
    sha: fileData.sha,
  })

  if (pushResult.commit) {
    // Trigger Vercel deploy from the updated GitHub files
    let vercelProjectId: string | null = null
    try {
      vercelProjectId = await triggerDeploy(repo, chosenFile, newContent)
    } catch (_) {}

    return NextResponse.json({ 
      success: true, 
      description: editPlan.description,
      commit: pushResult.commit.sha?.slice(0, 7),
      file: chosenFile,
      vercelProjectId,
      // Include undo info
      undo: {
        repo,
        file: chosenFile,
        content: Buffer.from(originalContent).toString('base64'),
        sha: pushResult.content?.sha, // sha of the new file for next update
        description: editPlan.description,
      }
    })
  }

  return NextResponse.json({ error: 'Push failed', detail: pushResult }, { status: 500 })
}

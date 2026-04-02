import { NextRequest, NextResponse } from 'next/server'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!
const GITHUB_API = 'https://api.github.com'

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
    return NextResponse.json({ 
      success: true, 
      description: editPlan.description,
      commit: pushResult.commit.sha?.slice(0, 7),
      file: editPlan.file
    })
  }

  return NextResponse.json({ error: 'Push failed', detail: pushResult }, { status: 500 })
}

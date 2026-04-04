import { NextRequest, NextResponse } from 'next/server'

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
Reply in this exact JSON format with no other text: {file: ..., description: ..., commit: ...}`

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

    const jsonMatch = reply.match(/\{[\s\S]*?\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (parsed.commit || parsed.file) {
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

    return NextResponse.json({
      success: false,
      error: 'Rosie responded but not in the expected format',
      rosieReply: reply,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Request failed' }, { status: 500 })
  }
}

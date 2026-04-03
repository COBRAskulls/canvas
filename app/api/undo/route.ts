import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { repo, commitBefore, description } = await req.json()

  if (!repo || !commitBefore) {
    return NextResponse.json({ error: 'Missing repo or commitBefore' }, { status: 400 })
  }

  const message = `In the GitHub repo COBRAskulls/${repo}, revert the last change.
The commit before the change was: ${commitBefore}
Description of what was changed: ${description}

Revert this change by restoring the file to its state before commit ${commitBefore}.
Push the revert to GitHub on the main branch.
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

    const jsonMatch = reply.match(/\{[\s\S]*?\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        return NextResponse.json({ success: true, ...parsed, rosieReply: reply })
      } catch (_) {}
    }

    return NextResponse.json({ success: false, error: 'Could not parse undo response', rosieReply: reply })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'No projectId' }, { status: 400 })

  const res = await fetch(
    `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=1`,
    { headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` } }
  )
  const data = await res.json()
  const latest = data.deployments?.[0]
  
  return NextResponse.json({
    state: latest?.state || 'UNKNOWN',
    url: latest?.url ? `https://${latest.url}` : null,
    createdAt: latest?.createdAt,
  })
}

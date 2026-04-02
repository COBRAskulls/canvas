import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { message } = await req.json()
  
  const res = await fetch(`${process.env.NEXT_PUBLIC_ROSIE_API_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.PROXY_API_KEY}`,
    },
    body: JSON.stringify({ message }),
  })
  
  const data = await res.json()
  return NextResponse.json(data)
}

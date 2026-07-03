import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localDb.getSecret()}`,
    },
    body: JSON.stringify(body),
  })
  let data: unknown
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    data = await res.json()
  } else {
    const text = await res.text()
    data = { error: text || `Worker error ${res.status}` }
  }
  return NextResponse.json(data, { status: res.status })
}

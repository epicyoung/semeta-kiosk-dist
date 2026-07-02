import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'

export async function POST(req: NextRequest) {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
  const secret = localDb.getSecret()
  if (!workerUrl || !secret)
    return NextResponse.json({ error: 'not configured' }, { status: 500 })

  // Forward multipart directly to worker /api/upload — worker decides watermark from session
  const form = await req.formData()
  const res = await fetch(`${workerUrl}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
    body: form,
  })
  if (!res.ok) return NextResponse.json({ error: 'upload failed' }, { status: 502 })
  const data = await res.json()
  return NextResponse.json(data)
}

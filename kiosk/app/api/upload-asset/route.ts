import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'

export async function POST(req: NextRequest) {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
  const secret = localDb.getSecret()
  if (!workerUrl || !secret)
    return NextResponse.json({ error: 'not configured' }, { status: 500 })

  // Forward multipart directly to worker /api/upload — worker decides watermark from session
  const form = await req.formData()
  let res: Response
  try {
    res = await fetch(`${workerUrl}/api/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      body: form,
    })
  } catch (e) {
    // Worker unreachable (mati / URL salah / DNS). Surface alasannya, jangan 502 bisu.
    const msg = e instanceof Error ? e.message : 'fetch failed'
    return NextResponse.json({ error: `worker unreachable: ${msg}` }, { status: 502 })
  }
  if (!res.ok) {
    // Teruskan alasan asli dari Worker (status + body) — 502 generik bikin buta saat debug.
    const detail = await res.text().catch(() => '')
    console.error(`worker /api/upload ${res.status}: ${detail}`)
    return NextResponse.json(
      { error: 'upload failed', workerStatus: res.status, workerBody: detail.slice(0, 500) },
      { status: 502 },
    )
  }
  const data = await res.json()
  return NextResponse.json(data)
}

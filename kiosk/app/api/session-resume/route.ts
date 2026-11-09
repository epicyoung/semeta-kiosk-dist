import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'
import { assertLocalMutation } from '@/lib/local-request'

export async function POST(req: NextRequest) {
  try { assertLocalMutation(req) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Ditolak' }, { status: 403 }) }

  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
  const secret = localDb.getSecret()
  if (!workerUrl || !secret)
    return NextResponse.json({ error: 'not configured' }, { status: 500 })

  try {
    const res = await fetch(`${workerUrl}/api/session-resume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.ok ? 200 : 502 })
  } catch {
    return NextResponse.json({ error: 'unreachable' }, { status: 503 })
  }
}

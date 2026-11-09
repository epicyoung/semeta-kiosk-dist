import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'
import { assertLocalMutation } from '@/lib/local-request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST { event_type, metadata } — proxy same-origin ke Worker /api/visitor-log.
 * Secret kiosk cuma ada di server; browser ga pernah nerima kredensial.
 */
export async function POST(req: NextRequest) {
  try {
    assertLocalMutation(req)
  } catch {
    return NextResponse.json({ ok: false }, { status: 403 })
  }
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
  const secret = localDb.getSecret()
  if (!workerUrl || !secret) return NextResponse.json({ ok: false }, { status: 204 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body.event_type !== 'string') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  void fetch(`${workerUrl}/api/visitor-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ event_type: body.event_type, metadata: body.metadata ?? {} }),
  }).catch(() => {})
  return NextResponse.json({ ok: true })
}

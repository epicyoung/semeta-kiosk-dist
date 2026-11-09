import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'
import { assertLocalMutation } from '@/lib/local-request'
import { requireOperator } from '@/lib/operator-auth'

export const runtime = 'nodejs'

// Save the kiosk secret to semeta.config.json (runtime-read). Takes effect on the NEXT
// handshake — no restart. Operator-only: secret = identitas kiosk ke Worker.
export async function POST(req: NextRequest) {
  try {
    assertLocalMutation(req)
    requireOperator(req)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ditolak' }, { status: 403 })
  }
  const { secret } = await req.json().catch(() => ({ secret: '' }))
  if (typeof secret !== 'string' || !secret.trim()) {
    return NextResponse.json({ error: 'secret required' }, { status: 400 })
  }
  localDb.setSecret(secret)
  return NextResponse.json({ ok: true })
}

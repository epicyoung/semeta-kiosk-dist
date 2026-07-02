import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'

// Save the kiosk secret to semeta.config.json (runtime-read). Takes effect on the NEXT
// handshake — no restart. Plaintext on disk = same as .env.local; Budi already knows the
// secret, so zero security change. Enforcement stays at the Worker (secret = identity, the
// rental timer decides licensed); this config is just transport.
export async function POST(req: NextRequest) {
  const { secret } = await req.json()
  if (typeof secret !== 'string' || !secret.trim()) {
    return NextResponse.json({ error: 'secret required' }, { status: 400 })
  }
  localDb.setSecret(secret)
  return NextResponse.json({ ok: true })
}

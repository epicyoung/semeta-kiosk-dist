import { NextRequest, NextResponse } from 'next/server'
import { assertLocalRead } from '@/lib/local-request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Dulu: kirim email + password superuser PocketBase mentah ke browser.
// Sekarang: cuma status "udah diset atau belum". Kredensial tetap di server.
export async function GET(req: NextRequest) {
  try { assertLocalRead(req) } catch { return NextResponse.json({ configured: false }, { status: 403 }) }
  return NextResponse.json({
    configured: !!(process.env.POCKETBASE_EMAIL && process.env.POCKETBASE_PASSWORD),
  })
}

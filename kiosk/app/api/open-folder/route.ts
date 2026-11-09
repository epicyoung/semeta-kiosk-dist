import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import path from 'path'
import { assertLocalMutation } from '@/lib/local-request'
import { requireOperator } from '@/lib/operator-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    assertLocalMutation(req)
    requireOperator(req)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ditolak' }, { status: 403 })
  }
  const folderPath = path.resolve(process.cwd(), 'face_server', 'put-template-here')
  // execFile (bukan shell string) + error handler: missing explorer di macOS bukan crash.
  const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  execFile(opener, [folderPath], () => {})
  return NextResponse.json({ ok: true })
}

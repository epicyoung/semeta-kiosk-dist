import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import { assertLocalMutation } from '@/lib/local-request'
import { requireOperator } from '@/lib/operator-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Repo root = parent of kiosk/ (server cwd = kiosk/). restart.bat ada di situ.
const REPO_ROOT = path.resolve(process.cwd(), '..')

// POST → spawn restart.bat DETACHED lalu balas langsung. restart.bat sengaja jeda 2 detik
// sebelum kill (lihat file itu) → response ini nyampe browser dulu, baru chrome+node dimatiin.
// detached + unref = script lepas dari proses node ini; pas node mati (kill), .bat tetep lanjut.
export async function POST(req: NextRequest) {
  try {
    assertLocalMutation(req)
    requireOperator(req)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ditolak' }, { status: 403 })
  }
  try {
    const script = path.join(REPO_ROOT, 'restart.bat')
    const child = spawn('cmd.exe', ['/c', script], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    // Tanpa listener, ENOENT (mis. di macOS) jadi unhandled 'error' dan bisa nge-crash server.
    child.on('error', err => console.error('[restart] spawn gagal:', err.message))
    child.unref()
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'restart gagal'
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Repo root = parent of kiosk/ (server cwd = kiosk/). restart.bat ada di situ.
const REPO_ROOT = path.resolve(process.cwd(), '..')

// POST → spawn restart.bat DETACHED lalu balas langsung. restart.bat sengaja jeda 2 detik
// sebelum kill (lihat file itu) → response ini nyampe browser dulu, baru chrome+node dimatiin.
// detached + unref = script lepas dari proses node ini; pas node mati (kill), .bat tetep lanjut.
export async function POST() {
  try {
    const child = spawn('cmd.exe', ['/c', path.join(REPO_ROOT, 'restart.bat')], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'restart gagal'
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { getVersionInfo } from '@/lib/version'

const exec = promisify(execFile)
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Repo root = parent of kiosk/ (dev server cwd is kiosk/). Same as version.ts.
const REPO_ROOT = path.resolve(process.cwd(), '..')

// GET → cheap, read-only version check (local vs remote hash).
export async function GET() {
  const info = await getVersionInfo()
  return NextResponse.json(info)
}

// POST → pull latest source. --ff-only so a Budi machine that never edits source
// fast-forwards cleanly; if someone HAS edited tracked files, pull fails SAFE
// (no merge, no corruption) and we report it instead of forcing.
// pb_data is gitignored → NEVER touched by pull. Templates/frames Budi uploaded stay put.
export async function POST() {
  try {
    // Guard: must be a git clone, not an extracted archive.
    const before = await getVersionInfo()
    if (!before.isGit) {
      return NextResponse.json(
        { ok: false, error: 'not-git', message: 'Bukan git clone — update otomatis tidak tersedia. Install ulang dari bundle terbaru.' },
        { status: 400 },
      )
    }

    // git pull --ff-only origin
    try {
      await exec('git', ['pull', '--ff-only'], { cwd: REPO_ROOT, timeout: 120_000 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      // Non-fast-forward = local edits diverged. Fail safe, tell operator.
      if (/not possible to fast-forward|diverging|local changes/i.test(msg)) {
        return NextResponse.json(
          { ok: false, error: 'diverged', message: 'Ada perubahan lokal yang bentrok. Update dibatalkan (data aman). Hubungi admin.' },
          { status: 409 },
        )
      }
      // Anything else (offline, auth) → generic network failure.
      return NextResponse.json(
        { ok: false, error: 'pull-failed', message: 'git pull gagal — cek koneksi internet.' },
        { status: 502 },
      )
    }

    // npm install for any new/changed deps. Non-fatal if it fails — code already pulled.
    // Windows: npm is npm.cmd; call it explicitly so we DON'T need shell:true (which would
    // reintroduce shell-metachar parsing). Args are all static literals regardless.
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    let depsWarning: string | null = null
    try {
      await exec(npmBin, ['install', '--no-audit', '--no-fund'], { cwd: process.cwd(), timeout: 300_000 })
    } catch {
      depsWarning = 'Kode ter-update tapi npm install gagal. Restart mungkin error — jalanin setup.bat kalau begitu.'
    }

    const after = await getVersionInfo()
    if (before.current !== after.current) {
      try {
        const fs = await import('fs/promises')
        await fs.rm(path.join(process.cwd(), '.next', 'BUILD_ID'), { force: true })
      } catch {
        // non-fatal
      }
    }
    return NextResponse.json({
      ok: true,
      restartRequired: true,
      from: before.current,
      to: after.current,
      depsWarning,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Update gagal'
    return NextResponse.json({ ok: false, error: 'unknown', message }, { status: 500 })
  }
}

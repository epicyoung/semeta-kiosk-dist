import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const exec = promisify(execFile)

// Repo root = one level up from kiosk/ (LAUNCHER runs `npm run dev` inside kiosk/,
// so cwd is kiosk/; the .git lives at the dist-repo root that contains kiosk/).
const REPO_ROOT = path.resolve(process.cwd(), '..')

export type VersionInfo = {
  current: string | null   // local short hash, null if not a git repo
  latest: string | null    // remote short hash, null if offline / no remote
  hasUpdate: boolean
  isGit: boolean           // false = extracted archive, not a clone → Update disabled
  label: string | null     // v<tanggal-commit-HEAD>, mis. v2026.08.06 — otomatis dari git, NOL bump manual
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: REPO_ROOT, timeout: 15_000 })
  return stdout.trim()
}

// Label = tanggal commit HEAD (v2026.08.06). Dulu baca file VERSION statis → nyangkut di tanggal
// lama walau udah di-update. Tanggal commit = kapan build ini bener-bener dibikin, otomatis pas pull.
async function readVersionLabel(): Promise<string | null> {
  try {
    const date = await git(['show', '-s', '--format=%cd', '--date=short', 'HEAD']) // YYYY-MM-DD
    return date ? `v${date.replace(/-/g, '.')}` : null
  } catch {
    return null
  }
}

// Compare local HEAD vs remote HEAD. Both null-safe: no git → isGit:false;
// offline → latest:null, hasUpdate:false (never claim an update we can't fetch).
export async function getVersionInfo(): Promise<VersionInfo> {
  let current: string | null = null
  try {
    current = await git(['rev-parse', '--short', 'HEAD'])
  } catch {
    return { current: null, latest: null, hasUpdate: false, isGit: false, label: null }
  }
  const label = await readVersionLabel() // butuh git → dipanggil setelah isGit kepastiin

  let latest: string | null = null
  try {
    // ls-remote returns "<full-hash>\tHEAD"; take first 7 to match --short.
    const line = await git(['ls-remote', 'origin', 'HEAD'])
    const full = line.split(/\s+/)[0]
    latest = full ? full.slice(0, 7) : null
  } catch {
    latest = null // offline or no remote configured
  }

  return { current, latest, hasUpdate: computeHasUpdate(current, latest), isGit: true, label }
}

// Pure — unit-tested. Update only when we have BOTH hashes and they differ.
// Missing latest (offline) or equal hashes → no update.
export function computeHasUpdate(current: string | null, latest: string | null): boolean {
  if (!current || !latest) return false
  return current !== latest
}

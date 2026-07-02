import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PB_URL = process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090'
const EMAIL = process.env.POCKETBASE_EMAIL ?? ''
const PASSWORD = process.env.POCKETBASE_PASSWORD ?? ''
const EXTS = ['.jpg', '.jpeg', '.png']
const DEFAULT_CATEGORY = 'Semeta'

// ── image helpers (port dari manage-templates.js) ────────────────────────────

function toTitleCase(filename: string): string {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function getImageDimensions(fp: string): { w: number; h: number } | null {
  const buf = fs.readFileSync(fp)
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2
    while (i < buf.length - 8) {
      if (buf[i] !== 0xFF) break
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xC0 && marker <= 0xC3)
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }
      i += 2 + len
    }
  }
  return null
}

function isValidRatio(w: number, h: number): boolean {
  return Math.abs((w / h) - (2 / 3)) / (2 / 3) < 0.01
}

type FolderFile = { name: string; category: string; fp: string }

function scanFolder(inbox: string): FolderFile[] {
  if (!fs.existsSync(inbox)) return []
  const result: FolderFile[] = []
  for (const entry of fs.readdirSync(inbox, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const subdir = path.join(inbox, entry.name)
      for (const file of fs.readdirSync(subdir).filter(f => EXTS.includes(path.extname(f).toLowerCase())))
        result.push({ name: toTitleCase(file), category: entry.name, fp: path.join(subdir, file) })
    } else if (EXTS.includes(path.extname(entry.name).toLowerCase())) {
      result.push({ name: toTitleCase(entry.name), category: DEFAULT_CATEGORY, fp: path.join(inbox, entry.name) })
    }
  }
  return result
}

// ── PocketBase calls ──────────────────────────────────────────────────────────

async function login(): Promise<string> {
  const r = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
  })
  const body = await r.json() as { token?: string }
  if (!body.token) throw new Error('PocketBase login gagal — cek POCKETBASE_EMAIL/PASSWORD')
  return body.token
}

type PbTemplate = { id: string; name: string; category: string }

async function listTemplates(token: string): Promise<PbTemplate[]> {
  const r = await fetch(`${PB_URL}/api/collections/templates/records?perPage=500`, {
    headers: { Authorization: token },
  })
  const body = await r.json() as { items?: PbTemplate[] }
  return body.items ?? []
}

async function uploadTemplate(token: string, f: FolderFile): Promise<boolean> {
  const buf = fs.readFileSync(f.fp)
  const mime = path.extname(f.fp).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'
  const fd = new FormData()
  fd.append('name', f.name)
  fd.append('category', f.category)
  fd.append('engine_type', 'faceswap')
  fd.append('gender_filter', 'ALL')
  fd.append('token_cost', '1')
  fd.append('is_active', 'true')
  fd.append('thumbnail', new Blob([new Uint8Array(buf)], { type: mime }), path.basename(f.fp))
  const r = await fetch(`${PB_URL}/api/collections/templates/records`, {
    method: 'POST',
    headers: { Authorization: token },
    body: fd,
  })
  return r.ok
}

async function deleteTemplate(token: string, id: string): Promise<boolean> {
  const r = await fetch(`${PB_URL}/api/collections/templates/records/${id}`, {
    method: 'DELETE',
    headers: { Authorization: token },
  })
  return r.ok
}

// ── handler ────────────────────────────────────────────────────────────────────

export async function POST() {
  try {
    if (!EMAIL || !PASSWORD) {
      return NextResponse.json({ ok: false, error: 'POCKETBASE_EMAIL/PASSWORD belum di-set' }, { status: 500 })
    }

    const inbox = path.resolve(process.cwd(), 'face_server', 'put-template-here')
    const folderFiles = scanFolder(inbox)

    const token = await login()
    const pbTemplates = await listTemplates(token)

    const key = (category: string, name: string) => `${category}||${name}`
    const folderKeys = new Set(folderFiles.map(f => key(f.category, f.name)))
    const pbByKey = new Map(pbTemplates.map(t => [key(t.category, t.name), t]))

    const toAdd = folderFiles.filter(f => !pbByKey.has(key(f.category, f.name)))
    // ponytail: SAFETY FLOOR — folder kosong (fresh bundle / path salah) TIDAK boleh wipe semua PB.
    // Empty folder → skip semua delete. Buat clear total pakai CLI: manage-templates.js delete --all
    const toDelete = folderFiles.length === 0 ? [] : pbTemplates.filter(t => !folderKeys.has(key(t.category, t.name)))

    // Validasi rasio 2:3 untuk kandidat baru
    const valid: FolderFile[] = []
    const skipped: string[] = []
    for (const f of toAdd) {
      const dims = getImageDimensions(f.fp)
      if (!dims) { skipped.push(`${f.category}/${f.name} (tidak bisa baca dimensi)`); continue }
      if (!isValidRatio(dims.w, dims.h)) { skipped.push(`${f.category}/${f.name} (rasio ${dims.w}×${dims.h}, butuh 2:3)`); continue }
      valid.push(f)
    }

    let added = 0, deleted = 0
    for (const f of valid) if (await uploadTemplate(token, f)) added++
    for (const t of toDelete) if (await deleteTemplate(token, t.id)) deleted++

    return NextResponse.json({ ok: true, added, deleted, skipped })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Sync gagal'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

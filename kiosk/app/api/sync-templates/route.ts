import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { computeTargetHeight, computeTargetWidth, computeCropTop, computeCropLeft, HEADROOM_RATIO } from '@/lib/crop'
import { parseSidecar, type TemplateSidecar } from '@/lib/template-sidecar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PB_URL = process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090'
const EMAIL = process.env.POCKETBASE_EMAIL ?? ''
const PASSWORD = process.env.POCKETBASE_PASSWORD ?? ''
const EXTS = ['.jpg', '.jpeg', '.png']
const DEFAULT_CATEGORY = 'Semeta'
const FACE_SERVER_URL = process.env.FACE_SERVER_URL ?? 'http://localhost:8000'
const DETECT_TIMEOUT_MS = 10_000

type Face = { x: number; y: number; w: number; h: number }

// ── image helpers (port dari manage-templates.js) ────────────────────────────

function toTitleCase(filename: string): string {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// dims via sharp — robust untuk progressive JPEG / EXIF / WebP. Parser byte lama gagal diam-diam
// di sebagian export foto → file (kadang seluruh kategori) ke-skip "tidak bisa baca dimensi".
async function readDims(fp: string): Promise<{ w: number; h: number } | null> {
  try {
    const m = await sharp(fp).metadata()
    return m.width && m.height ? { w: m.width, h: m.height } : null
  } catch {
    return null
  }
}

type FolderFile = { name: string; category: string; fp: string; sidecar: TemplateSidecar | null }

// Sidecar <nama>.json di sebelah gambar → template comfy (engine_type + prompts + denoise).
// ponytail: edit sidecar SETELAH ke-sync gak auto-update (dedup by category||name) —
// hapus record di PB / rename file kalau mau re-sync isi barunya.
function readSidecar(imagePath: string): TemplateSidecar | null {
  const jsonPath = imagePath.replace(/\.[^.]+$/, '.json')
  if (!fs.existsSync(jsonPath)) return null
  try {
    return parseSidecar(fs.readFileSync(jsonPath, 'utf-8'))
  } catch {
    return null
  }
}

// Ask face_server for face boxes. Returns:
//   faceY = topmost face top (smallest y) → protects the highest head (vertical crop headroom)
//   faceCenterX = center X of that same topmost face → keeps it centered (horizontal crop)
// Never throws — on any failure returns detectDown:true and nulls (caller center-crops).
async function detectFace(fp: string): Promise<{ faceY: number | null; faceCenterX: number | null; detectDown: boolean }> {
  try {
    const buf = fs.readFileSync(fp)
    const mime = path.extname(fp).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'
    const fd = new FormData()
    fd.append('image', new Blob([new Uint8Array(buf)], { type: mime }), path.basename(fp))
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), DETECT_TIMEOUT_MS)
    const r = await fetch(`${FACE_SERVER_URL}/detect`, { method: 'POST', body: fd, signal: ctrl.signal })
    clearTimeout(timer)
    if (!r.ok) return { faceY: null, faceCenterX: null, detectDown: true }
    const body = await r.json() as { faces?: Face[] }
    const faces = body.faces ?? []
    if (faces.length === 0) return { faceY: null, faceCenterX: null, detectDown: false } // no face ≠ down
    // topmost face (smallest y); center X of THAT face
    const top = faces.reduce((a, b) => (b.y < a.y ? b : a))
    return { faceY: top.y, faceCenterX: top.x + top.w / 2, detectDown: false }
  } catch {
    return { faceY: null, faceCenterX: null, detectDown: true }
  }
}

// ponytail: semua thumbnail dinormalisasi ke JPEG — PNG auto→JPEG, cap lebar biar ga kegedean.
// 1400px lebar = 2100px tinggi (2:3), cukup untuk thumbnail print-quality. Naikin kalau kurang tajam.
const MAX_WIDTH = 1400
const JPEG_QUALITY = 88

// Finalize: sharp pipeline → cap width → flatten alpha (PNG transparan jadi putih) → JPEG.
// Selalu keluar image/jpeg apa pun input. withoutEnlargement: gambar kecil ga di-upscale.
async function normalizeJpeg(pipeline: ReturnType<typeof sharp>): Promise<Buffer> {
  return pipeline
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer()
}

// Normalized JPEG cropped ke aspect target sesuai ORIENTASI: portrait → 2:3, landscape → 3:2.
// (Dulu semua dipaksa 2:3 → template landscape jadi sliver portrait.) Always re-encode JPEG.
// Sudah pas target → no crop. Else face-aware crop:
//   Lebih TINGGI dari target (ratio < target) → trim atas/bawah, headroom 10% di atas kepala.
//   Lebih LEBAR dari target (ratio > target) → trim kiri/kanan, muka teratas di-center X.
async function cropToAspect(fp: string, w: number, h: number):
  Promise<{ buf: Buffer; mime: string; cropped: boolean; detectDown: boolean }> {
  const mime = 'image/jpeg' // ponytail: output selalu JPEG, apa pun input
  const targetRatio = w > h ? 3 / 2 : 2 / 3 // landscape 3:2, else portrait 2:3 (w/h)
  const ratio = w / h
  if (Math.abs(ratio - targetRatio) / targetRatio < 0.01) {
    const buf = await normalizeJpeg(sharp(fp))
    return { buf, mime, cropped: false, detectDown: false }
  }
  const { faceY, faceCenterX, detectDown } = await detectFace(fp)
  if (ratio < targetRatio) {
    // lebih tinggi dari target → trim atas/bawah, lebar penuh
    const targetH = computeTargetHeight(w, targetRatio)
    const headroom = Math.round(targetH * HEADROOM_RATIO)
    const top = computeCropTop(h, targetH, faceY, headroom)
    const buf = await normalizeJpeg(sharp(fp).extract({ top, left: 0, width: w, height: targetH }))
    return { buf, mime, cropped: true, detectDown }
  }
  // lebih lebar dari target → trim kiri/kanan, tinggi penuh, center di muka
  const targetW = computeTargetWidth(h, targetRatio)
  const left = computeCropLeft(w, targetW, faceCenterX)
  const buf = await normalizeJpeg(sharp(fp).extract({ top: 0, left, width: targetW, height: h }))
  return { buf, mime, cropped: true, detectDown }
}

function scanFolder(inbox: string): FolderFile[] {
  if (!fs.existsSync(inbox)) return []
  const result: FolderFile[] = []
  for (const entry of fs.readdirSync(inbox, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const subdir = path.join(inbox, entry.name)
      for (const file of fs.readdirSync(subdir).filter(f => EXTS.includes(path.extname(f).toLowerCase()))) {
        const fp = path.join(subdir, file)
        result.push({ name: toTitleCase(file), category: entry.name, fp, sidecar: readSidecar(fp) })
      }
    } else if (EXTS.includes(path.extname(entry.name).toLowerCase())) {
      const fp = path.join(inbox, entry.name)
      result.push({ name: toTitleCase(entry.name), category: DEFAULT_CATEGORY, fp, sidecar: readSidecar(fp) })
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
  const all: PbTemplate[] = []
  // Paginate — tanpa ini, >500 template bikin dedup bocor → tiap sync upload ganda.
  for (let page = 1; ; page++) {
    const r = await fetch(`${PB_URL}/api/collections/templates/records?perPage=500&page=${page}`, {
      headers: { Authorization: token },
    })
    if (!r.ok) break
    const body = await r.json() as { items?: PbTemplate[]; page?: number; totalPages?: number }
    for (const it of body.items ?? []) all.push(it)
    if (!body.totalPages || (body.page ?? page) >= body.totalPages) break
  }
  return all
}

async function uploadTemplate(token: string, f: FolderFile, buf: Buffer, mime: string): Promise<boolean> {
  const fd = new FormData()
  fd.append('name', f.name)
  fd.append('category', f.category)
  // Sidecar nentuin engine + prompt; tanpa sidecar = faceswap kayak biasa (zero breaking)
  fd.append('engine_type', f.sidecar?.engine_type ?? 'faceswap')
  if (f.sidecar?.positive_prompt) fd.append('positive_prompt', f.sidecar.positive_prompt)
  if (f.sidecar?.negative_prompt) fd.append('negative_prompt', f.sidecar.negative_prompt)
  if (f.sidecar?.denoise != null) fd.append('denoise', String(f.sidecar.denoise))
  fd.append('gender_filter', 'ALL')
  // Photo Print: nol AI call → nol token. Overlay PNG mentah masuk field 'overlay'
  // (alpha selamat) — thumbnail tetep JPEG flatten putih sebagai preview grid.
  const isPrint = f.sidecar?.engine_type === 'print'
  fd.append('token_cost', isPrint ? '0' : '1')
  if (isPrint) {
    if (f.sidecar?.shot_count != null) fd.append('shot_count', String(f.sidecar.shot_count))
    if (f.sidecar?.print_size) fd.append('print_size', f.sidecar.print_size)
    if (path.extname(f.fp).toLowerCase() === '.png') {
      const raw = fs.readFileSync(f.fp)
      fd.append('overlay', new Blob([new Uint8Array(raw)], { type: 'image/png' }), path.basename(f.fp))
    }
  }
  fd.append('is_active', 'true')
  // ponytail: isi selalu JPEG (normalizeJpeg) → paksa ekstensi .jpg biar filename ga bohong (input .png)
  const jpgName = path.basename(f.fp, path.extname(f.fp)) + '.jpg'
  fd.append('thumbnail', new Blob([new Uint8Array(buf)], { type: mime }), jpgName)
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

    // Crop tiap kandidat ke aspect orientasinya (portrait 2:3 / landscape 3:2, face-aware) lalu upload.
    let added = 0, cropped = 0, deleted = 0, anyDetectDown = false
    const skipped: { name: string; reason: string }[] = []

    for (const f of toAdd) {
      const dims = await readDims(f.fp)
      if (!dims) { skipped.push({ name: `${f.category}/${f.name}`, reason: 'tidak bisa baca dimensi' }); continue }
      try {
        // Print: overlay bukan foto — crop 2:3 + face-detect ngerusak preview layout non-2:3
        // (2R landscape kepotong jadi sliver). Cukup resize+flatten putih buat thumbnail grid.
        const out = f.sidecar?.engine_type === 'print'
          ? { buf: await normalizeJpeg(sharp(f.fp)), mime: 'image/jpeg', cropped: false, detectDown: false }
          : await cropToAspect(f.fp, dims.w, dims.h)
        if (out.detectDown) anyDetectDown = true
        const ok = await uploadTemplate(token, f, out.buf, out.mime)
        if (ok) { added++; if (out.cropped) cropped++ }
        else skipped.push({ name: `${f.category}/${f.name}`, reason: 'upload gagal' })
      } catch {
        skipped.push({ name: `${f.category}/${f.name}`, reason: 'crop/encode gagal (file rusak?)' })
      }
    }
    for (const t of toDelete) if (await deleteTemplate(token, t.id)) deleted++

    return NextResponse.json({ ok: true, added, cropped, deleted, detectDown: anyDetectDown, skipped })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Sync gagal'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

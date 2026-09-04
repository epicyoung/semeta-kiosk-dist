import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { computeTargetHeight, computeTargetWidth, computeCropTop, computeCropLeft, HEADROOM_RATIO } from '@/lib/crop'
import { parseSidecar, type TemplateSidecar } from '@/lib/template-sidecar'
import { hasPlaceholder } from '@/lib/prompt-input'

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

type FolderFile = { name: string; category: string; fp: string; sidecar: TemplateSidecar | null; mtime: number }

// Sidecar <nama>.json di sebelah gambar → template comfy (engine_type + prompts + denoise).
function readSidecar(imagePath: string): TemplateSidecar | null {
  const jsonPath = imagePath.replace(/\.[^.]+$/, '.json')
  if (!fs.existsSync(jsonPath)) return null
  try {
    return parseSidecar(fs.readFileSync(jsonPath, 'utf-8'))
  } catch {
    return null
  }
}

// mtime "efektif" satu template = yang paling baru antara gambar & sidecar-nya. Dua-duanya
// bisa diedit sendiri-sendiri (crop ulang thumbnail, atau tweak prompt doang) dan keduanya
// sama-sama harus micu re-sync. Referensi (gf-products.jpg dkk) ikut dihitung juga — ganti
// file referensi tanpa nyentuh apa pun yang lain tetep kudu naik ulang.
function effectiveMtime(fp: string, sidecar: TemplateSidecar | null): number {
  const stamps = [statMtime(fp)]
  const jsonPath = fp.replace(/\.[^.]+$/, '.json')
  if (fs.existsSync(jsonPath)) stamps.push(statMtime(jsonPath))
  for (const ref of sidecar?.reference_images ?? []) {
    const refPath = path.join(path.dirname(fp), ref)
    if (fs.existsSync(refPath)) stamps.push(statMtime(refPath))
  }
  // Frame ikut dihitung: ganti PNG overlay doang (tanpa nyentuh jpeg/json) tetep kudu
  // micu re-sync, kalau nggak frame lama nyangkut di PocketBase.
  if (sidecar?.frame) {
    const framePath = path.join(path.dirname(fp), sidecar.frame)
    if (fs.existsSync(framePath)) stamps.push(statMtime(framePath))
  }
  return Math.max(...stamps)
}

function statMtime(fp: string): number {
  try {
    return fs.statSync(fp).mtimeMs
  } catch {
    return 0
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
        const sidecar = readSidecar(fp)
        result.push({ name: toTitleCase(file), category: entry.name, fp, sidecar, mtime: effectiveMtime(fp, sidecar) })
      }
    } else if (EXTS.includes(path.extname(entry.name).toLowerCase())) {
      const fp = path.join(inbox, entry.name)
      const sidecar = readSidecar(fp)
      result.push({ name: toTitleCase(entry.name), category: DEFAULT_CATEGORY, fp, sidecar, mtime: effectiveMtime(fp, sidecar) })
    }
  }
  // Gambar referensi (engine 'api') DAN frame per-template tinggal SEFOLDER sama thumbnail,
  // jadi loop di atas ngangkat mereka jadi template sendiri — halte kosong nongol di grid
  // pilihan tamu. Buang berdasarkan yang beneran dirujuk sidecar, bukan tebak-tebakan nama file.
  const referenced = new Set<string>()
  for (const f of result) {
    for (const ref of f.sidecar?.reference_images ?? []) {
      referenced.add(path.resolve(path.dirname(f.fp), ref))
    }
    if (f.sidecar?.frame) {
      referenced.add(path.resolve(path.dirname(f.fp), f.sidecar.frame))
    }
  }
  return referenced.size === 0 ? result : result.filter(f => !referenced.has(path.resolve(f.fp)))
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

// `updated` = field sistem PocketBase, selalu ada. Dipakai buat bandingin sama mtime file
// di folder → file yang diedit setelah ke-sync bakal kedeteksi & diganti otomatis.
type PbTemplate = { id: string; name: string; category: string; updated?: string }

// Toleransi 2 detik. `updated` PB ditulis beberapa ratus ms SETELAH file dibaca pas upload,
// jadi tanpa buffer tiap file yang barusan naik kebaca "lebih baru" lagi di sync berikutnya
// → upload ulang selamanya tiap kali operator pencet ↻. Juga nutupin mtime FAT/SMB yang
// resolusinya kasar (FAT32 = 2 detik).
export const STALE_TOLERANCE_MS = 2000

/** File di folder lebih baru dari record PB → perlu diganti.
 *  PocketBase ngirim `updated` format "2026-09-02 10:30:00.123Z" — spasi, bukan 'T'.
 *  UTC-nya WAJIB dipaksa: tanpa 'Z' string kebaca sebagai waktu LOKAL, dan di WIB (UTC+7)
 *  tiap record kegeser 7 jam ke belakang → semua file kebaca stale terus, re-upload tiap sync. */
export function isStale(fileMtimeMs: number, pbUpdated: string | undefined): boolean {
  if (!pbUpdated) return false // PB ga ngasih timestamp → jangan nebak, biarin apa adanya
  const iso = pbUpdated.trim().replace(' ', 'T')
  const recordMs = Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z')
  if (Number.isNaN(recordMs)) return false
  return fileMtimeMs > recordMs + STALE_TOLERANCE_MS
}

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
  if (f.sidecar?.video_positive_prompt) fd.append('video_positive_prompt', f.sidecar.video_positive_prompt)
  if (f.sidecar?.video_negative_prompt) fd.append('video_negative_prompt', f.sidecar.video_negative_prompt)
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
  // Frame per-template: PNG sefolder yang OTOMATIS kepasang pas template ini dipilih.
  // Naik ke field 'overlay' yang SAMA dipakai Photo Print — PNG mentah, alpha selamat
  // (normalizeJpeg bakal ngeflatten transparansi jadi putih, jadi JANGAN lewat situ).
  // Bukan koleksi `frames`: itu global + tamu yang milih + di-cap perPage=10.
  if (f.sidecar?.frame) {
    const dir = path.dirname(f.fp)
    const framePath = path.join(dir, f.sidecar.frame)
    // Sabuk kedua sesudah isSafeFilename di parseSidecar — resolve yang nyasar keluar
    // folder template jangan dibaca sama sekali.
    if (!path.relative(dir, framePath).startsWith('..') && fs.existsSync(framePath)) {
      const frameBuf = fs.readFileSync(framePath)
      fd.append('overlay', new Blob([new Uint8Array(frameBuf)], { type: 'image/png' }),
        path.basename(f.sidecar.frame))
    }
  }
  // Engine 'api' (Nano Banana Pro): model + label input + rasio, lalu gambar referensi BG.
  if (f.sidecar?.api_model) fd.append('api_model', f.sidecar.api_model)
  if (f.sidecar?.input_field) fd.append('input_label', f.sidecar.input_field.label)
  if (f.sidecar?.aspect_ratio) fd.append('aspect_ratio', f.sidecar.aspect_ratio)
  if (f.sidecar?.billing_id) fd.append('billing_id', f.sidecar.billing_id)
  for (const refName of f.sidecar?.reference_images ?? []) {
    const dir = path.dirname(f.fp)
    const refPath = path.join(dir, refName)
    // parseSidecar udah nolak path traversal; ini sabuk kedua — kalau resolve-nya nyasar
    // keluar folder template, jangan dibaca sama sekali.
    if (path.relative(dir, refPath).startsWith('..')) continue
    // Keberadaan file udah dicek di addTasks (template di-SKIP kalau hilang) — kalau
    // sampai di sini masih gak ada, lebih baik meledak daripada naik tanpa BG diam-diam.
    if (!fs.existsSync(refPath)) throw new Error(`referensi hilang: ${refName}`)
    // Di-downscale pakai pipeline yang sama — referensi ini bakal jadi data URI di tiap
    // request generate, jadi ukurannya kena ongkos berulang, bukan sekali.
    const refBuf = await normalizeJpeg(sharp(refPath))
    fd.append('reference', new Blob([new Uint8Array(refBuf)], { type: 'image/jpeg' }),
      path.basename(refName, path.extname(refName)) + '.jpg')
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

export async function POST(req: Request) {
  const rebuild = new URL(req.url).searchParams.get('rebuild') === '1'
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        if (!EMAIL || !PASSWORD) {
          send({ ok: false, error: 'POCKETBASE_EMAIL/PASSWORD belum di-set' })
          controller.close()
          return
        }

        const inbox = path.resolve(process.cwd(), 'face_server', 'put-template-here')
        const folderFiles = scanFolder(inbox)

        send({ kind: 'progress', message: 'Koneksi ke database...' })
        const token = await login()
        
        send({ kind: 'progress', message: 'Membaca data lama...' })
        const pbTemplates = await listTemplates(token)

        const key = (category: string, name: string) => `${category}||${name}`
        const folderKeys = new Set(folderFiles.map(f => key(f.category, f.name)))
        const pbByKey = new Map(pbTemplates.map(t => [key(t.category, t.name), t]))

        // rebuild (repair): wipe SEMUA record lalu re-add semua dari folder. Masih perlu buat
        // kasus "record ada tapi file storage ilang" (thumbnail 404) — mtime ga ketolong di situ
        // karena file folder-nya sendiri gak berubah. Delete dijalanin duluan (bawah) → nama bebas.
        const stale = rebuild ? [] : folderFiles.filter(f => {
          const t = pbByKey.get(key(f.category, f.name))
          return t ? isStale(f.mtime, t.updated) : false
        })
        const staleIds = new Set(stale.map(f => pbByKey.get(key(f.category, f.name))!.id))
        const staleSet = new Set(stale) // identity-based — addTasks pakai ini buat misahin laporan

        // File baru + file yang berubah. Yang berubah di-delete dulu (bawah) biar namanya bebas.
        const toAdd = rebuild
          ? folderFiles
          : [...folderFiles.filter(f => !pbByKey.has(key(f.category, f.name))), ...stale]

        // Mirror-delete: record yang filenya udah ga ada di folder. Dijaga guard folder-kosong —
        // folder ke-unmount / path salah bikin scan balik [] dan tanpa guard itu ngehapus SEMUA
        // template. Record stale tetep ikut kehapus (bakal langsung naik lagi di addTasks).
        const orphans = folderFiles.length === 0
          ? []
          : pbTemplates.filter(t => !folderKeys.has(key(t.category, t.name)))
        const toDelete = rebuild
          ? pbTemplates
          : [...orphans, ...pbTemplates.filter(t => staleIds.has(t.id))]

        let added = 0, cropped = 0, deleted = 0, updated = 0, anyDetectDown = false
        const skipped: { name: string; reason: string }[] = []

        const total = toAdd.length + toDelete.length
        let current = 0

        const runWithConcurrency = async (tasks: (() => Promise<void>)[], limit: number) => {
          const executing = new Set<Promise<void>>()
          for (const task of tasks) {
            const p = task().finally(() => executing.delete(p))
            executing.add(p)
            if (executing.size >= limit) await Promise.race(executing)
          }
          await Promise.all(executing)
        }

        const addTasks = toAdd.map(f => async () => {
          const dims = await readDims(f.fp)
          if (!dims) { skipped.push({ name: `${f.category}/${f.name}`, reason: 'tidak bisa baca dimensi' }); current++; send({ kind: 'progress', current, total, name: f.name }); return }
          // Sidecar minta tamu ngetik tapi prompt-nya gak punya {input} → tamu tetep disuruh
          // ngetik, nama dibuang diam-diam, token tetep kepotong. Tolak di sini, bukan nanti.
          if (f.sidecar?.input_field && !hasPlaceholder(f.sidecar.positive_prompt ?? '')) {
            skipped.push({ name: `${f.category}/${f.name}`, reason: 'input_field diisi tapi positive_prompt gak punya {input}' })
            current++; send({ kind: 'progress', current, total, name: f.name }); return
          }
          // Referensi didaftarin tapi filenya gak ada → SKIP seluruh template. Gambar
          // put-template-here di-gitignore sedangkan sidecar-nya enggak, jadi "JSON ada,
          // gambar gak ikut" itu kejadian normal pas clone/pull. Kalau cuma referensinya
          // yang dilewat, template tetep naik dan tamu bayar token buat hasil TANPA BG —
          // gagal diam-diam yang cuma ketauan setelah cetakan keluar.
          const missingRef = (f.sidecar?.reference_images ?? [])
            .find(r => !fs.existsSync(path.join(path.dirname(f.fp), r)))
          if (missingRef) {
            skipped.push({ name: `${f.category}/${f.name}`, reason: `file referensi gak ada: ${missingRef}` })
            current++; send({ kind: 'progress', current, total, name: f.name }); return
          }
          try {
            const out = f.sidecar?.engine_type === 'print'
              ? { buf: await normalizeJpeg(sharp(f.fp)), mime: 'image/jpeg', cropped: false, detectDown: false }
              : await cropToAspect(f.fp, dims.w, dims.h)
            if (out.detectDown) anyDetectDown = true
            const ok = await uploadTemplate(token, f, out.buf, out.mime)
            if (ok) {
              added++
              if (out.cropped) cropped++
              if (staleSet.has(f)) updated++ // pengganti, bukan template baru — buat laporan
            }
            else skipped.push({ name: `${f.category}/${f.name}`, reason: 'upload gagal' })
          } catch {
            skipped.push({ name: `${f.category}/${f.name}`, reason: 'crop/encode gagal (file rusak?)' })
          } finally {
            current++
            send({ kind: 'progress', current, total, name: f.name })
          }
        })
        
        const deleteTasks = toDelete.map(t => async () => {
          try {
            if (await deleteTemplate(token, t.id)) deleted++
          } finally {
            current++
            send({ kind: 'progress', current, total, name: t.name, isDelete: true })
          }
        })

        // Delete SELALU duluan sekarang. Dulu jalur normal add-dulu-baru-delete, tapi begitu
        // sync bisa ngeganti file yang berubah, record lamanya WAJIB ilang sebelum yang baru
        // naik — kalau kebalik, dua-duanya nyangkut sebagai record kembar dengan nama sama.
        await runWithConcurrency(deleteTasks, 5)
        await runWithConcurrency(addTasks, 5)

        // `added` & `deleted` ngitung baru + pengganti campur. Dipisah buat laporan biar kebaca:
        // "3 baru, 2 diperbarui" lebih jelas buat operator dari "5 ditambah, 2 dihapus".
        send({
          ok: true,
          added: added - updated,
          cropped,
          deleted: Math.max(0, deleted - updated),
          updated,
          detectDown: anyDetectDown,
          skipped,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Sync gagal'
        send({ ok: false, error: message })
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  })
}

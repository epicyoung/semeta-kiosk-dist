import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { eventFolder, eventDirPath } from '@/lib/event'
import { GALLERY_DIR, parseEntries, printFilename, sidecarFilename, type GalleryEntry } from '@/lib/gallery'

/**
 * GET  /api/gallery?event_name=Fun+Run
 *   → { entries: GalleryEntry[] } — terbaru dulu, entry yang file print-nya
 *     udah ilang dari disk di-skip (jangan kasih tombol Print yang bikin printer diem).
 *
 * POST /api/gallery
 *   { event_name, seq, image_base64?, r2_key_b?, m? }
 *   → nulis file print (kalau image_base64 dikasih) + sidecar .gallery/{seq}.json
 *
 * Sidecar = SATU FILE PER SESI, bukan satu index besar. Kalau listrik mati di tengah
 * tulis, yang rusak cuma satu foto — bukan seluruh riwayat event. Ga perlu locking,
 * ga ada race antar proses.
 */

function galleryDirFor(eventName: string): string {
  return path.join(eventDirPath(eventFolder(eventName)), GALLERY_DIR)
}

export async function GET(req: NextRequest) {
  const eventName = req.nextUrl.searchParams.get('event_name')
  if (!eventName) {
    return NextResponse.json({ error: 'event_name required' }, { status: 400 })
  }

  const dir = galleryDirFor(eventName)

  let files: string[]
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  } catch (err) {
    // Folder belum ada = event baru / belum ada foto. Bukan error.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return NextResponse.json({ entries: [] })
    }
    console.error('[gallery] gagal baca folder', err)
    return NextResponse.json({ error: 'gagal baca gallery' }, { status: 500 })
  }

  const raw: string[] = []
  for (const f of files) {
    try { raw.push(fs.readFileSync(path.join(dir, f), 'utf8')) }
    catch { /* satu file kekunci/rusak jangan gugurkan sisanya */ }
  }

  // File print bisa ilang (operator bersihin folder, disk penuh). Entry-nya di-skip
  // biar tombol Print ga pernah nunjuk file yang ga ada.
  const entries = parseEntries(raw).filter(e => {
    try { return fs.existsSync(e.print_path) } catch { return false }
  })

  return NextResponse.json({ entries })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { event_name, seq, image_base64, r2_key_b, m } = body ?? {}

  if (typeof event_name !== 'string' || typeof seq !== 'string') {
    return NextResponse.json({ error: 'event_name, seq required' }, { status: 400 })
  }
  // seq masuk ke filename → digits-only matiin path traversal (sama kayak save-local).
  if (!/^\d{1,4}$/.test(seq)) {
    return NextResponse.json({ error: 'seq must be 1-4 digits' }, { status: 400 })
  }

  const eventDir = eventDirPath(eventFolder(event_name))
  const dir = path.join(eventDir, GALLERY_DIR)
  const sidecarPath = path.join(dir, sidecarFilename(seq))
  const printPath = path.join(eventDir, printFilename(event_name, seq))

  fs.mkdirSync(dir, { recursive: true })

  // Tulis file print kalau dikasih. Ini buffer komposit yang UDAH JADI —
  // ga ngejalanin ulang pipeline apa pun.
  if (typeof image_base64 === 'string' && image_base64.length > 0) {
    const b64 = image_base64.includes(',') ? image_base64.split(',')[1] : image_base64
    const bytes = Buffer.from(b64, 'base64')
    // Header sniff, sama alasannya kayak save-local: base64 sampah lolos kalau yang
    // dicek cuma "ada isinya", dan rusaknya baru ketauan pas mau cetak ulang.
    const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50
    if (!isJpeg && !isPng) {
      return NextResponse.json({ error: 'bukan JPEG/PNG yang sah' }, { status: 422 })
    }
    fs.writeFileSync(printPath, bytes)
  }

  // Thumbnail pakai file AI yang udah ditulis save-local. Kalau ga ada, pakai
  // file print itu sendiri — tetap ada yang bisa dilihat di grid.
  const existing = readSidecar(sidecarPath)
  const entry: GalleryEntry = {
    seq,
    created_at: existing?.created_at ?? new Date().toISOString(),
    thumb_path: existing?.thumb_path ?? printPath,
    print_path: fs.existsSync(printPath) ? printPath : (existing?.print_path ?? printPath),
    ...(typeof r2_key_b === 'string' && r2_key_b ? { r2_key_b } : existing?.r2_key_b ? { r2_key_b: existing.r2_key_b } : {}),
    ...(typeof m === 'number' && m > 0 ? { m } : existing?.m ? { m: existing.m } : {}),
  }

  // OVERWRITE PENUH, bukan read-modify-write parsial: seluruh entry udah dipegang
  // di sini, jadi ga perlu merge field-by-field yang rawan race.
  fs.writeFileSync(sidecarPath, JSON.stringify(entry, null, 2))

  return NextResponse.json({ ok: true, entry })
}

function readSidecar(p: string): GalleryEntry | null {
  try {
    const parsed = parseEntries([fs.readFileSync(p, 'utf8')])
    return parsed[0] ?? null
  } catch {
    return null
  }
}

// Gallery cetak-ulang: tamu balik ke booth minta dicetakin lagi buat temennya.
// Operator buka dari Settings, pilih foto, tekan Print.
//
// Sumber daftar = DISK LOKAL (sidecar .gallery/*.json), bukan R2 — biar foto yang
// belum sempat ke-upload tetap kelihatan dan tetap bisa dicetak pas WiFi venue jelek.
// QR cuma muncul kalau r2_key_b udah ada.
//
// Yang dicetak = file komposit FINAL yang udah jadi (print_path), BUKAN komposit
// ulang. Pipeline komposit (print-layout, overlay 4R/2R, orientasi) kompleks;
// ngejalanin ulang bikin cetakan ulang bisa beda dari cetakan pertama kalau operator
// ganti setting di tengah event.

// CATATAN: file ini dipakai DUA sisi — route server (app/api/gallery) dan komponen
// client (GalleryPanel). Karena itu JANGAN import '@/lib/event': dia narik `fs`+`path`
// ke bundle client, dan Turbopack bakal nge-trace next.config.ts lalu gagal build.
// slugify di bawah sengaja diduplikasi (satu baris) — dites biar ga drift dari aslinya.

export const MICROSITE_BASE = 'https://semeta-microsite.pages.dev'

/** Sama persis dgn slugify() di lib/event.ts — lihat catatan di atas soal kenapa ga di-import. */
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'
}

/** Nama folder sidecar di dalam folder event. Dot-prefix = ga keliatan pas operator buka folder. */
export const GALLERY_DIR = '.gallery'

export type GalleryVariant = {
  id: string
  created_at: string
  label: string
  master_file: string
  thumbnail_file: string
  sheet_2up_file?: string
  width: number
  height: number
  print_size?: import('./types').PrintSize
  recipe: 'single_4r' | 'single_strip' | 'sheet_2up' | 'iso_page'
  fit?: 'cover' | 'contain'
  frame_id?: string | null
  warning?: string
}

export type GalleryEntry = {
  seq: string          // "001"
  created_at: string   // ISO
  thumb_path: string   // file B — buat grid
  print_path: string   // komposit final siap-print
  r2_key_b?: string    // ada ⇒ QR bisa ditampilkan
  m?: number           // jumlah aset tambahan, buat URL /s
  a?: number           // jumlah original tambahan (_A2.._AN), buat URL &a
  schema_version?: 2
  event_id?: string
  event_name?: string
  session_id?: string
  updated_at?: string
  share_url?: string
  variants?: GalleryVariant[]
  source?: 'camera' | 'fast_import'
  source_name?: string
  import_job_id?: string
}

/** fun-run-20260914-001-print-semeta.jpg — sejajar konvensi originalFilename/aiFilename. */
export function printFilename(eventName: string, seq: string, date = new Date()): string {
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${slugify(eventName)}-${y}${mo}${d}-${seq}-print-semeta.jpg`
}

/** Nama file sidecar buat satu sesi. */
export function sidecarFilename(seq: string): string {
  return `${seq}.json`
}

/**
 * Nama file yang boleh diserve /api/gallery/image: basename doang, ekstensi gambar.
 * Nolak separator, "..", drive letter, dan NUL — tanpa ini ?file=../../.. kebaca.
 * Pure, biar bisa dites tanpa nembak route.
 */
export function isSafeGalleryFile(file: string | null | undefined): file is string {
  if (typeof file !== 'string' || file.length === 0) return false
  if (file.includes('/') || file.includes('\\')) return false
  if (file.includes('..') || file.includes('\0')) return false
  if (/^[a-zA-Z]:/.test(file)) return false
  return /\.(jpg|jpeg|png)$/i.test(file)
}

/**
 * Ambil nomor urut dari `state.base` — bentuknya "{eventFolder}-{paddedSeq}",
 * dirakit di finalizeLocal(). null kalau bentuknya ga cocok (jangan nebak:
 * seq salah = sidecar nimpa sesi tamu lain).
 */
export function seqFromBase(base: string | undefined | null): string | null {
  if (typeof base !== 'string') return null
  const m = base.match(/-(\d{3,4})$/)
  return m ? m[1] : null
}

function isEntry(v: unknown): v is GalleryEntry {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const e = v as Record<string, unknown>
  return (
    typeof e.seq === 'string' &&
    typeof e.created_at === 'string' &&
    typeof e.thumb_path === 'string' &&
    typeof e.print_path === 'string'
  )
}

export function isGalleryEntry(v: unknown): v is GalleryEntry {
  if (!isEntry(v)) return false
  const e = v as Record<string, unknown>
  return (
    (e.share_url === undefined || typeof e.share_url === 'string') &&
    (e.variants === undefined || (Array.isArray(e.variants) && e.variants.every(isGalleryVariant)))
  )
}

function isGalleryVariant(value: unknown): value is GalleryVariant {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const sizes = ['4R_PORTRAIT', '4R_LANDSCAPE', '2R_STRIP', 'A4_PORTRAIT', 'A4_LANDSCAPE', 'A3_PORTRAIT', 'A3_LANDSCAPE']
  return typeof v.id === 'string' && typeof v.created_at === 'string' && typeof v.label === 'string' &&
    isSafeGalleryFile(v.master_file as string) && isSafeGalleryFile(v.thumbnail_file as string) &&
    (v.sheet_2up_file === undefined || isSafeGalleryFile(v.sheet_2up_file as string)) &&
    typeof v.width === 'number' && v.width > 0 && typeof v.height === 'number' && v.height > 0 &&
    ['single_4r', 'single_strip', 'sheet_2up', 'iso_page'].includes(String(v.recipe)) &&
    (v.print_size === undefined || sizes.includes(String(v.print_size))) &&
    (v.fit === undefined || ['cover', 'contain'].includes(String(v.fit)))
}

/**
 * Parse isi file-file sidecar → daftar entry, terbaru dulu.
 * JSON korup / field wajib hilang di-skip diam-diam: satu sesi rusak jangan
 * bikin seluruh gallery ilang.
 */
export function parseEntries(rawFiles: string[]): GalleryEntry[] {
  const out: GalleryEntry[] = []
  for (const raw of rawFiles) {
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { continue }
    if (isEntry(parsed)) out.push(parsed)
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/**
 * URL microsite buat QR. null kalau fotonya belum ke-upload — UI nampilin
 * "Belum terunggah", BUKAN QR kosong yang nuntun tamu ke halaman 404.
 */
export function entryQrUrl(entry: GalleryEntry): string | null {
  if (entry.share_url) return entry.share_url
  if (!entry.r2_key_b) return null
  const m = entry.m && entry.m > 0 ? `&m=${entry.m}` : ''
  const a = entry.a && entry.a > 0 ? `&a=${entry.a}` : ''
  return `${MICROSITE_BASE}/s?b=${encodeURIComponent(entry.r2_key_b)}${m}${a}`
}

/** URL microsite lengkap dari key R2 — dipakai buat simpan & tampilkan QR persis sama. */
export function shareUrlFor(key: string, m = 0, a = 0): string {
  return `${MICROSITE_BASE}/s?b=${encodeURIComponent(key)}${m > 0 ? `&m=${m}` : ''}${a > 0 ? `&a=${a}` : ''}`
}

/** Parse "{eventFolder}-{paddedSeq}" → identitas sesi yang aman dipakai sebagai path. */
export function sessionIdentity(base: string): { eventId: string; seq: string } {
  const match = /^([a-z0-9][a-z0-9-]{0,180})-(\d{3,8})$/.exec(base)
  if (!match) throw new Error('Identitas sesi tidak valid')
  return { eventId: match[1], seq: match[2] }
}

export function galleryImageUrl(eventId: string, file: string): string {
  return `/api/gallery/image?event_id=${encodeURIComponent(eventId)}&file=${encodeURIComponent(file.split(/[\\/]/).pop() ?? '')}`
}

export function galleryEventId(eventName: string, date = new Date()): string {
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${slugify(eventName)}-${y}${mo}${d}`
}


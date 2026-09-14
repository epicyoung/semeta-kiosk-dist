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

export type GalleryEntry = {
  seq: string          // "001"
  created_at: string   // ISO
  thumb_path: string   // file B — buat grid
  print_path: string   // komposit final siap-print
  r2_key_b?: string    // ada ⇒ QR bisa ditampilkan
  m?: number           // jumlah aset tambahan, buat URL /s
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
  if (!entry.r2_key_b) return null
  const m = entry.m && entry.m > 0 ? `&m=${entry.m}` : ''
  return `${MICROSITE_BASE}/s?b=${encodeURIComponent(entry.r2_key_b)}${m}`
}


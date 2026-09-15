import { NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { stripExif } from '@/lib/jpeg-exif'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Sony (ZV-E1 dkk) full-res capture via gphoto2 — padanan macOS/Linux dari jalur Canon
// digiCamControl. Bedanya gphoto2 KASIH FILE LANGSUNG ke path yang kita tentuin, jadi ga
// perlu polling folder session kayak canon-capture: satu proses, keluar file, selesai.
//
// Kamera WAJIB di mode USB "PC Remote" (bukan Mass Storage, bukan USB Streaming).
// Mode USB Streaming bikin kamera jadi webcam UVC — gphoto2 ga nemu apa-apa di situ.
const GPHOTO_BIN = process.env.GPHOTO2_PATH ?? 'gphoto2'

// Sony nulis + transfer ~1-3s. 20s ngasih ruang buat AF lambat / kartu penuh, tapi tetep
// jauh di bawah kesabaran tamu. Timeout = proses di-kill, bukan digantung.
const CAPTURE_TIMEOUT_MS = 20_000

type Ok = { ok: true; buf: Buffer }
type Err = { ok: false; error: string; status: number }

function run(args: string[], cwd: string, timeout: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    execFile(GPHOTO_BIN, args, { cwd, timeout, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException).code === 'number'
        ? (err as unknown as { code: number }).code
        : err ? 1 : 0
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

/**
 * Pesan gphoto2 mentah → sebab yang bisa ditindak operator di lapangan.
 * Diekspor buat di-test tanpa nyolok kamera.
 */
export function diagnose(stderr: string, stdout: string): string {
  const s = `${stderr}\n${stdout}`
  if (/could not find|no camera|model not/i.test(s)) {
    return 'Kamera ga kedeteksi. Cek kabel USB + mode kamera = PC Remote (bukan Mass Storage / USB Streaming).'
  }
  // macOS ptpcamera rebut device begitu kamera nyolok — penyebab #1 "Could not claim".
  if (/claim the usb device|could not claim|device is busy|-53/i.test(s)) {
    return 'USB direbut proses lain. Tutup Imaging Edge / Photos, lalu: killall PTPCamera'
  }
  if (/out of focus|focus/i.test(s)) {
    return 'Kamera gagal fokus. Pindah ke manual focus atau tambah cahaya.'
  }
  if (/ENOENT/i.test(s)) {
    return 'gphoto2 ga ke-install. Jalanin: brew install gphoto2'
  }
  return (stderr || stdout || 'gphoto2 gagal').trim().slice(0, 300)
}

async function capturePhoto(): Promise<Ok | Err> {
  // Dir sekali pakai per jepretan. gphoto2 nolak nimpa file yang udah ada (dan --force-overwrite
  // ga konsisten antar versi), jadi dir bersih lebih murah daripada ngurus nama bentrok.
  let dir: string
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'semeta-sony-'))
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'tmpdir gagal', status: 500 }
  }

  try {
    const target = 'capture.jpg'
    const { code, stdout, stderr } = await run(
      ['--capture-image-and-download', '--filename', target, '--force-overwrite'],
      dir,
      CAPTURE_TIMEOUT_MS,
    )

    const file = path.join(dir, target)
    // Exit code gphoto2 ga selalu bisa dipercaya (ada versi yang exit 0 tapi ga nulis file),
    // jadi keberadaan file yang jadi kebenaran — bukan code-nya.
    if (!fs.existsSync(file)) {
      const err = diagnose(stderr, stdout)
      return { ok: false, error: err, status: code === 0 ? 504 : 502 }
    }

    const buf = fs.readFileSync(file)
    if (buf.length === 0) return { ok: false, error: 'File kosong dari kamera', status: 502 }

    // EXIF dibuang server-side — alasan sama persis dgn canon-capture: Chrome udah nyabut
    // imageOrientation:'none', fallback-nya apply EXIF Orientation diam-diam → capture keputer
    // dobel vs live view. Tanpa EXIF, rotasi kiosk jadi satu-satunya kebenaran.
    return { ok: true, buf: stripExif(buf) }
  } finally {
    // Foto asli tetap ada di kartu kamera; tmp ini cuma jalur transit.
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

// Satu kamera, satu shutter. Tanpa gerbang ini dua request barengan bikin gphoto2 kedua
// kena "Could not claim the USB device" dan capture gagal tanpa sebab yang jelas.
let inFlight: Promise<Ok | Err> | null = null

export async function POST() {
  if (inFlight) return NextResponse.json({ error: 'Capture lain masih jalan' }, { status: 409 })
  inFlight = capturePhoto()
  try {
    const res = await inFlight
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    return NextResponse.json({ dataUrl: `data:image/jpeg;base64,${res.buf.toString('base64')}` })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Capture gagal' }, { status: 500 })
  } finally {
    inFlight = null
  }
}

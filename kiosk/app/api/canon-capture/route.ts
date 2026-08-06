import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { stripExif } from '@/lib/jpeg-exif'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Canon DSLR full-res capture via digiCamControl webserver (port 5513) + baca JPEG hasil dari
// folder output. SERVER-SIDE sengaja: browser fetch ke 5513 lintas-origin kena CORS (digiCamControl
// ga kirim header CORS). Node ga kena CORS + bisa baca file kamera → full-res, bukan resolusi webcam.
const DCC = 'http://127.0.0.1:5513'
// Command capture. digiCamControl baru: ?CMD=Capture. Versi LAMA / beda: set env
// CANON_CAPTURE_CMD (mis. "?slc=capture") tanpa ganti kode.
const CAPTURE_CMD = process.env.CANON_CAPTURE_CMD ?? '?CMD=Capture'
// Root output digiCamControl. Default: SEMUA session di-scan rekursif — nama session bebas
// (Session1 / Session2 / per-tanggal), jadi ga peduli client pakai session apa. Set
// CANON_SESSION_DIR kalau kamera nyimpen di luar ~/Pictures/digiCamControl.
const SESSION_ROOT = process.env.CANON_SESSION_DIR
  ?? path.join(os.homedir(), 'Pictures', 'digiCamControl')

const CAPTURE_TIMEOUT_MS = 15_000
const POLL_MS = 400

// LV aktif pas shutter = sumber hang klasik (600D + lensa AF nyari fokus di LV → kamera
// gantung, satu-satunya obat cabut USB/restart dCC). Hide LV dulu — best-effort, gagal pun
// capture tetep dicoba. Nyalainnya TIDAK di sini: canon-live self-healing nge-Show lagi
// otomatis pas frame diminta (sesi berikutnya / balik ke live). CANON_LV_HIDE=off buat skip.
const LV_HIDE_CMD = process.env.CANON_LV_HIDE ?? 'LiveViewWnd_Hide'

/** Newest .jpg di dir + subfolder (default 2 level: digiCamControl/<session>/foto). Nama bebas. */
function newestJpeg(dir: string, depth = 2): { file: string; mtimeMs: number } | null {
  let best: { file: string; mtimeMs: number } | null = null
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return null }
  for (const e of entries) {
    const fp = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (depth <= 0) continue
      const sub = newestJpeg(fp, depth - 1)
      if (sub && (!best || sub.mtimeMs > best.mtimeMs)) best = sub
    } else if (/\.jpe?g$/i.test(e.name)) {
      let st: fs.Stats
      try { st = fs.statSync(fp) } catch { continue }
      if (!best || st.mtimeMs > best.mtimeMs) best = { file: fp, mtimeMs: st.mtimeMs }
    }
  }
  return best
}

/** Baca file setelah size stabil — hindari kebaca pas kamera masih nulis (JPEG kepotong). */
async function readStable(file: string): Promise<Buffer | null> {
  let last = -1
  for (let i = 0; i < 12; i++) {
    let sz: number
    try { sz = fs.statSync(file).size } catch { return null }
    if (sz > 0 && sz === last) return fs.readFileSync(file)
    last = sz
    await new Promise(r => setTimeout(r, 200))
  }
  try { return fs.readFileSync(file) } catch { return null }
}

export async function POST() {
  // Baseline: mtime file terbaru SEBELUM jepret → penanda mana yang "baru" (across semua session).
  const before = newestJpeg(SESSION_ROOT)?.mtimeMs ?? 0

  // Matiin LV dulu biar shutter ga balapan sama sensor live view (lihat catatan LV_HIDE_CMD).
  if (LV_HIDE_CMD !== 'off') {
    try { await fetch(`${DCC}/?CMD=${LV_HIDE_CMD}`, { cache: 'no-store' }) } catch { /* best-effort */ }
  }

  // Trigger shutter.
  try {
    const r = await fetch(`${DCC}/${CAPTURE_CMD}`, { cache: 'no-store' })
    if (!r.ok) return NextResponse.json({ error: `digiCamControl HTTP ${r.status} (cmd ${CAPTURE_CMD})` }, { status: 502 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed'
    return NextResponse.json({ error: `digiCamControl 5513 unreachable — webserver ON? (${msg})` }, { status: 502 })
  }

  // Poll: file BARU (mtime > baseline) di seluruh pohon session. DSLR jepret + tulis ~1-3s.
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS))
    const latest = newestJpeg(SESSION_ROOT)
    if (latest && latest.mtimeMs > before) {
      const buf = await readStable(latest.file)
      if (buf) {
        // EXIF dibuang DI SINI (bukan di browser): imageOrientation:'none' udah dicabut Chrome,
        // fallback-nya diam-diam apply EXIF Orientation → capture portrait keputer dobel vs live.
        // Tanpa EXIF, decode browser = pixel mentah → rotasi kiosk satu-satunya kebenaran.
        const clean = stripExif(buf)
        // Shutter kelar & file aman → nyalain LV lagi (fire-and-forget, ga nahan response).
        // Retake / shot berikutnya / tamu berikutnya dapet live seger tanpa nunggu freeze-detect.
        if (LV_HIDE_CMD !== 'off') {
          fetch(`${DCC}/?CMD=LiveViewWnd_Show`, { cache: 'no-store' })
            .then(() => fetch(`${DCC}/?CMD=LiveViewWnd_Maximized`, { cache: 'no-store' }))
            .catch(() => { /* best-effort — mount restart & freeze-detect jadi jaring pengaman */ })
        }
        return NextResponse.json({ dataUrl: `data:image/jpeg;base64,${clean.toString('base64')}`, file: path.basename(latest.file) })
      }
    }
  }
  // Sampai sini = shutter ke-trigger tapi ga ada file baru. Biasanya: Transfer mode bukan
  // "Save to PC", command capture beda versi (set CANON_CAPTURE_CMD), atau folder di luar SESSION_ROOT.
  return NextResponse.json(
    { error: `Foto baru ga muncul di ${SESSION_ROOT} (timeout). Cek: Transfer="Save to PC", command capture (CANON_CAPTURE_CMD), atau folder session.` },
    { status: 504 },
  )
}

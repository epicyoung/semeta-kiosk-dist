import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Canon DSLR full-res capture via digiCamControl webserver (port 5513) + baca JPEG hasil dari
// session folder. SERVER-SIDE sengaja: browser fetch ke 5513 lintas-origin kena CORS (digiCamControl
// ga kirim header CORS). Node ga kena CORS + bisa baca file kamera → full-res, bukan resolusi webcam.
const DCC = 'http://127.0.0.1:5513'
// Default output digiCamControl. Override via env kalau Budi ganti folder session di digiCamControl.
const SESSION_DIR = process.env.CANON_SESSION_DIR
  ?? path.join(os.homedir(), 'Pictures', 'digiCamControl', 'Session1')

/** File .jpg termuda di dir (by mtime). null kalau kosong. */
function newestJpeg(dir: string): { file: string; mtimeMs: number } | null {
  let best: { file: string; mtimeMs: number } | null = null
  for (const name of fs.readdirSync(dir)) {
    if (!/\.jpe?g$/i.test(name)) continue
    const st = fs.statSync(path.join(dir, name))
    if (!best || st.mtimeMs > best.mtimeMs) best = { file: path.join(dir, name), mtimeMs: st.mtimeMs }
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
  // Baseline: mtime file terbaru SEBELUM jepret → penanda mana yang "baru".
  let before = 0
  try { before = newestJpeg(SESSION_DIR)?.mtimeMs ?? 0 } catch { /* folder belum ada; kebuat pas capture */ }

  // Trigger capture (dengan autofocus). digiCamControl webserver: /?CMD=Capture → "OK".
  try {
    const r = await fetch(`${DCC}/?CMD=Capture`, { cache: 'no-store' })
    if (!r.ok) return NextResponse.json({ error: `digiCamControl ${r.status}` }, { status: 502 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed'
    return NextResponse.json({ error: `digiCamControl unreachable (5513): ${msg}` }, { status: 502 })
  }

  // Poll session folder buat file BARU (mtime > baseline). DSLR jepret + tulis file ~1-3s.
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 400))
    let latest: { file: string; mtimeMs: number } | null = null
    try { latest = newestJpeg(SESSION_DIR) } catch { continue }
    if (latest && latest.mtimeMs > before) {
      const buf = await readStable(latest.file)
      if (buf) {
        return NextResponse.json({
          dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`,
          file: path.basename(latest.file),
        })
      }
    }
  }
  return NextResponse.json(
    { error: `foto baru ga muncul di ${SESSION_DIR} (capture timeout). Cek CMD=Capture & folder session digiCamControl.` },
    { status: 504 },
  )
}

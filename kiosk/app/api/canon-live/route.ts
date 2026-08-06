import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Canon DSLR live preview: proxy 1 JPEG frame dari digiCamControl (SERVER-SIDE, hindari CORS —
// alasan sama kayak canon-capture). Frontend <img> nunjuk ke /api/canon-live (same-origin) +
// refresh berkala jadi live-ish. digiCamControl liveview butuh di-START dulu (LiveViewWnd_Show),
// baru frame ada di /liveview.jpg. Endpoint frame beda antar versi → coba beberapa, env override.
const DCC = 'http://127.0.0.1:5513'
// Kandidat endpoint frame JPEG digiCamControl (urut kemungkinan). Override total via env.
const FRAME_PATHS = (process.env.CANON_LIVE_PATH ?? 'liveview.jpg,preview.jpg,live').split(',')
// Command buat nyalain LV. Klik tombol LV di GUI digiCamControl ngirim SEKUENS (show window +
// init sensor), tapi HTTP LiveViewWnd_Show doang cuma buka window → di 600D + lensa AF, sensor LV
// ga "hidup" tanpa trigger. Kirim Show → Maximized (nendang sensor). Override via env.
// CATATAN: lensa 600D lebih baik di MF — AF bikin LV gantung nyari fokus.
const LV_CMDS = (process.env.CANON_LV_CMDS ?? 'LiveViewWnd_Show,LiveViewWnd_Maximized').split(',')

// ponytail: liveOn = frame udah pernah sukses (BUKAN "command udah dikirim"). Selama belum pernah
// dapet frame, tiap GET nembak LiveViewWnd_Show lagi → self-healing sampai LV bener nyala, jadi
// operator ga perlu klik LV manual di digiCamControl. Sekali sukses, stop spam command.
// Reset pas proses restart (dev HMR bikin module baru).
let liveOn = false

// Deteksi FREEZE: dCC nyajiin frame BASI (HTTP 200, byte identik) pas LV mati/hang — self-healing
// berbasis "fetch gagal" buta total sama kasus ini (inilah kenapa tamu kedua dapet layar beku &
// operator kudu klik LV manual di dCC). Kamera nyata selalu ada noise antar frame; byte identik
// > FREEZE_MS berturut-turut = hampir pasti file cache, bukan pemandangan diam → tendang LV.
const FREEZE_MS = 3_000
let prevFrame: Buffer | null = null
let lastChangeAt = 0

async function startLiveView(): Promise<void> {
  for (const cmd of LV_CMDS) {
    try { await fetch(`${DCC}/?CMD=${cmd.trim()}`, { cache: 'no-store' }) } catch { /* best-effort */ }
  }
}

async function fetchFrame(): Promise<Response | null> {
  for (const p of FRAME_PATHS) {
    try {
      const r = await fetch(`${DCC}/${p.trim()}`, { cache: 'no-store' })
      if (r.ok) return r
    } catch {
      /* coba path berikutnya */
    }
  }
  return null
}

// Restart PAKSA live view — tombol refresh di layar live. Buat kasus "ngadat" yang self-healing
// ga bisa liat: frame NGEFREEZE tapi HTTP tetep 200 (self-healing cuma ke-trigger pas fetch
// GAGAL). Hide → jeda → Show ulang = dCC re-init sensor LV.
export async function POST() {
  liveOn = false
  prevFrame = null
  lastChangeAt = 0
  try { await fetch(`${DCC}/?CMD=LiveViewWnd_Hide`, { cache: 'no-store' }) } catch { /* best-effort */ }
  await new Promise(r => setTimeout(r, 400))
  await startLiveView()
  return NextResponse.json({ ok: true })
}

export async function GET() {
  // Belum pernah sukses → coba nyalain LV dulu (self-healing). Udah nyala → langsung ambil frame.
  if (!liveOn) await startLiveView()
  let frame = await fetchFrame()
  // Frame kosong pas awal (LV baru start, sensor belum warm) → jeda pendek, coba lagi.
  if (!frame) {
    await new Promise(r => setTimeout(r, 400))
    frame = await fetchFrame()
  }
  if (!frame) {
    liveOn = false // gagal → GET berikutnya nembak LiveViewWnd_Show lagi
    return NextResponse.json(
      { error: 'liveview frame ga ada. Cek digiCamControl konek + kamera ON + CANON_LIVE_PATH.' },
      { status: 502 },
    )
  }
  liveOn = true
  const buf = Buffer.from(await frame.arrayBuffer())
  // Freeze check — frame identik kelamaan = LV mati diam-diam → restart LV OTOMATIS.
  // Frame basi tetep dibalikin (biar layar ga item); poll berikutnya udah dapet yang seger.
  const now = Date.now()
  if (prevFrame && prevFrame.equals(buf)) {
    if (lastChangeAt && now - lastChangeAt > FREEZE_MS) {
      liveOn = false
      await startLiveView()
      lastChangeAt = now // jangan spam Show tiap poll 200ms — kick lagi paling cepat FREEZE_MS
    }
  } else {
    prevFrame = buf
    lastChangeAt = now
  }
  return new NextResponse(buf, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
  })
}

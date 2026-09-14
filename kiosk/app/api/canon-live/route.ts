import { NextResponse } from 'next/server'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { nextAction, isValidDccPath, DCC_DEFAULT_PATH } from '@/lib/dcc-supervisor'

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

// ── Supervisor dCC ────────────────────────────────────────────────────────
// Keputusannya di lib/dcc-supervisor.ts (pure, dites). Di sini eksekusinya.

const EXEC = promisify(execFile)

/** Proses CameraControl.exe lagi jalan? Dipakai buat mutusin launch vs show. */
async function isDccRunning(): Promise<boolean> {
  try {
    const { stdout } = await EXEC('tasklist', ['/FI', 'IMAGENAME eq CameraControl.exe', '/NH'], {
      windowsHide: true, timeout: 5_000,
    })
    return /CameraControl\.exe/i.test(stdout)
  } catch {
    // tasklist gagal ⇒ jangan ngaku-ngaku mati; mati palsu bikin spawn dobel.
    return true
  }
}

/** Jalankan dCC, lepas dari proses kiosk (detached) biar ga ikut mati. */
async function launchDcc(exePath: string): Promise<boolean> {
  if (!isValidDccPath(exePath)) {
    console.error('[canon-live] path dCC ga sah, ga dijalankan:', exePath)
    return false
  }
  try {
    const child = spawn(exePath, [], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    return true
  } catch (err) {
    console.error('[canon-live] gagal jalanin dCC:', err)
    return false
  }
}

/** Force quit dCC yang nge-hang. /F wajib — proses hang ga respon permintaan halus. */
async function killDcc(): Promise<void> {
  try {
    await EXEC('taskkill', ['/F', '/IM', 'CameraControl.exe', '/T'], {
      windowsHide: true, timeout: 8_000,
    })
  } catch {
    // exit code non-nol wajar kalau prosesnya emang udah ga ada.
  }
}

let showAttempts = 0
let lastKillAt = 0
let supervising = false

/**
 * Satu putaran supervisi. Dipanggil pas GET nemu masalah (frame ga ada / beku).
 * Guard `supervising` nahan tumpang-tindih: poll jalan tiap 200ms, tanpa ini
 * bisa ada lima kill barengan.
 */
async function superviseOnce(frameOk: boolean, frozenMs: number): Promise<void> {
  if (supervising) return
  supervising = true
  try {
    const dccAlive = await isDccRunning()
    const action = nextAction({
      dccAlive, frameOk, frozenMs, showAttempts, lastKillAt, now: Date.now(),
    })

    switch (action) {
      case 'show':
        showAttempts += 1
        await startLiveView()
        break
      case 'kill':
        console.warn('[canon-live] dCC ga pulih sesudah', showAttempts, 'x show — force quit')
        lastKillAt = Date.now()
        showAttempts = 0
        await killDcc()
        break
      case 'launch': {
        const exe = process.env.DCC_PATH?.trim() || readDccPathFromConfig() || DCC_DEFAULT_PATH
        console.warn('[canon-live] dCC ga jalan — menjalankan:', exe)
        if (await launchDcc(exe)) {
          // dCC butuh waktu sebelum HTTP-nya siap; LV di-Show pas poll berikutnya.
          await new Promise(r => setTimeout(r, 2_500))
          showAttempts = 0
        }
        break
      }
      default:
        break // 'none' / 'cooldown' — sengaja diem
    }
  } finally {
    supervising = false
  }
}

/** Path exe dCC dari semeta.config.json (diisi operator di Settings). */
function readDccPathFromConfig(): string | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'semeta.config.json'), 'utf8')
    const p = JSON.parse(raw)?.dcc_path
    return typeof p === 'string' && p.trim() ? p.trim() : null
  } catch {
    return null
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
export async function POST(req: Request) {
  liveOn = false
  prevFrame = null
  lastChangeAt = 0

  // ?off=1 — matiin LV pas keluar dari layar capture. Sensor Canon nyala terus
  // itu bikin bodi panas & batre kekuras padahal ga ada yang difoto.
  const off = new URL(req.url).searchParams.get('off') === '1'
  if (off) {
    try { await fetch(`${DCC}/?CMD=LiveViewWnd_Hide`, { cache: 'no-store' }) } catch { /* best-effort */ }
    return NextResponse.json({ ok: true, liveView: 'off' })
  }

  // Tombol R. Kalau dCC-nya sendiri yang hang, Hide→Show ga akan mempan —
  // supervisor yang mutusin perlu force quit / launch atau enggak.
  const dccAlive = await isDccRunning()
  if (!dccAlive) {
    const exe = process.env.DCC_PATH?.trim() || readDccPathFromConfig() || DCC_DEFAULT_PATH
    const ok = await launchDcc(exe)
    if (ok) await new Promise(r => setTimeout(r, 2_500))
    await startLiveView()
    return NextResponse.json({ ok, action: 'launch', exe })
  }

  try { await fetch(`${DCC}/?CMD=LiveViewWnd_Hide`, { cache: 'no-store' }) } catch { /* best-effort */ }
  await new Promise(r => setTimeout(r, 400))
  await startLiveView()

  // Beri kesempatan LV bangun; kalau frame tetap ga muncul, naikin ke force quit.
  await new Promise(r => setTimeout(r, 1_200))
  const probe = await fetchFrame()
  if (!probe) {
    showAttempts = Number.MAX_SAFE_INTEGER // lewati jatah show, langsung eskalasi
    await superviseOnce(false, 0)
    return NextResponse.json({ ok: true, action: 'escalated' })
  }

  showAttempts = 0
  return NextResponse.json({ ok: true, action: 'show' })
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
    // Frame ga ada = kemungkinan dCC belum jalan / nge-hang. Supervisor yang
    // mutusin: jalanin dCC, Show ulang, atau force quit kalau Show ga mempan.
    void superviseOnce(false, 0)
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
    const frozenMs = lastChangeAt ? now - lastChangeAt : 0
    if (frozenMs > FREEZE_MS) {
      liveOn = false
      // Dulu langsung startLiveView() terus-terusan. Kalau dCC-nya sendiri yang
      // hang, Show ga akan pernah mempan dan layar beku selamanya sampai
      // operator kill manual. Sekarang supervisor yang naik level ke force quit.
      void superviseOnce(true, frozenMs)
      lastChangeAt = now // jangan spam tiap poll 200ms — kick lagi paling cepat FREEZE_MS
    }
  } else {
    prevFrame = buf
    lastChangeAt = now
    showAttempts = 0 // frame seger = apa pun yang barusan dilakuin, berhasil
  }
  return new NextResponse(buf, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
  })
}

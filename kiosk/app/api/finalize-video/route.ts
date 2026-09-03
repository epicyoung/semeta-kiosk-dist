import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { eventFolder, eventDirPath, videoFilename } from '@/lib/event'

// POST { video_url, overlay_png?, event_name, seq }
// Download mp4 dari FAL → ffmpeg letterbox ke 2:3 (bar item atas/bawah kalau 16:9) → burn
// overlay PNG (frame + QR, transparan) → simpan lokal. Return path final.
//
// ffmpeg = binary bundled (bukan npm dep) — panggil via spawn absolute path biar Kiosk
// PORTABLE: taruh ffmpeg.exe di kiosk/bin/, colok ke Mini PC manapun, langsung jalan tanpa
// install / setting PATH manual di lapangan. Resolusi: FFMPEG_PATH env → bundled bin/ →
// PATH 'ffmpeg' (fallback dev). Gagal apa pun = 500, caller (Preview) fallback ke video mentah.
//
// Target 2:3 = 1080x1620 (portrait strip). Video sumber di-scale muat lebar/tinggi lalu di-pad
// hitam → aspect apa pun jadi 2:3 clean, ga ke-crop (spec: item2 aja, yg penting clean).
const OUT_W = 1080
const OUT_H = 1620

// Pure — bikin argv ffmpeg buat letterbox 2:3 (+overlay opsional). Diekspor buat di-test tanpa
// nge-spawn ffmpeg beneran. scale decrease + pad = aspect apa pun → 2:3 clean, zero crop.
export function buildFfmpegArgs(inMp4: string, outPath: string, overlayPng: string | null): string[] {
  // FULL WIDTH (FIT WIDTH): Scale lebar ke 1080, tinggi ngikut proporsional.
  // - Kalau hasil tinggi < 1620 (horizontal): pad hitam atas bawah ("atas bawah item").
  // - Kalau hasil tinggi > 1620 (vertical 9:16): crop atas bawah ("atas bawah ke potong").
  // SATU template literal, TANPA concat '+' dan TANPA komentar sebaris di tengahnya.
  // Bentuk lama (`a` + // komentar \n `b` + …) ke-mangle minifier build produksi: potongan
  // sesudah tiap komentar KEBUANG, chain jadi "scale=1080pad=1080:max(ih\,1620crop=1080:1620"
  // → ffmpeg "No option name" → /api/finalize-video 500 → video ga ke-save & ga ke-upload,
  // padahal dev (unminified) jalan mulus. Jangan pecah lagi jadi concat.
  //   scale : lebar fixed 1080, tinggi proporsional genap (-2)
  //   pad   : kalau hasilnya lebih pendek dari 1620 → bar hitam atas-bawah
  //   crop  : kalau kepanjangan (9:16) → potong atas-bawah, center
  const padChain = `scale=${OUT_W}:-2,pad=${OUT_W}:max(ih\\,${OUT_H}):(ow-iw)/2:(oh-ih)/2:black,crop=${OUT_W}:${OUT_H}`
  if (overlayPng) {
    return [
      '-y', '-i', inMp4, '-i', overlayPng,
      '-filter_complex',
      `[0:v]${padChain}[bg];[1:v]scale=${OUT_W}:${OUT_H}[ov];[bg][ov]overlay=0:0[v]`,
      // -map WAJIB di jalur filter_complex. Tanpa itu ffmpeg milih stream sendiri dan audio
      // input KEBUANG — '-c:a copy' jadi mubazir karena ga ada audio yang kepetakan. Provider
      // yang audionya nyala (LTX native) bakal keluar bisu, dan kita tetep bayar penuh.
      '-map', '[v]',
      // '?' = opsional: provider yang audionya mati (VEO/KLING generate_audio:false) ga punya
      // stream 0:a sama sekali → tanpa '?' ffmpeg exit 1 dan SELURUH finalize gagal.
      '-map', '0:a?',
      '-c:a', 'copy', '-movflags', '+faststart', outPath,
    ]
  }
  // Jalur -vf (tanpa overlay): ffmpeg auto-map 1 video + 1 audio, audio ikut sendiri.
  return ['-y', '-i', inMp4, '-vf', padChain, '-c:a', 'copy', '-movflags', '+faststart', outPath]
}

// Kandidat lokasi ffmpeg.exe bundled — dicek berurutan, yang pertama ada dipakai.
// process.cwd() = root project di dev/next start; sesuai Electron migration, prod nanti bisa
// override lewat FFMPEG_PATH (process.cwd() ga reliable di Electron packaged).
function bundledCandidates(): string[] {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return [
    path.join(process.cwd(), 'bin', exe),
    path.join(process.cwd(), 'kiosk', 'bin', exe), // kalau cwd di root monorepo
  ]
}

// Resolusi ffmpeg: 1) FFMPEG_PATH (override eksplisit, menang selalu) 2) bundled bin/
// 3) 'ffmpeg' dari PATH (fallback dev). Pure-ish (baca env+fs) → di-test lewat resolveFfmpeg.
export function resolveFfmpeg(
  env: string | undefined,
  candidates: string[],
  exists: (p: string) => boolean,
): string {
  if (env) return env
  for (const c of candidates) if (exists(c)) return c
  return 'ffmpeg'
}

function ffmpegBin(): string {
  return resolveFfmpeg(process.env.FFMPEG_PATH, bundledCandidates(), p => fs.existsSync(p))
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegBin(), args, { windowsHide: true })
    let err = ''
    p.stderr.on('data', d => { err += d.toString() })
    p.on('error', reject) // ffmpeg ga ketemu / gagal spawn
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-500)}`)))
  })
}

export async function POST(req: NextRequest) {
  const { video_url, overlay_png, event_name, seq } = await req.json()
  if (typeof video_url !== 'string' || typeof event_name !== 'string' || typeof seq !== 'string') {
    return NextResponse.json({ error: 'video_url, event_name, seq required' }, { status: 400 })
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'semeta-vid-'))
  const inMp4 = path.join(tmp, 'in.mp4')
  const overlayPng = path.join(tmp, 'overlay.png')
  const dir = eventDirPath(eventFolder(event_name))
  fs.mkdirSync(dir, { recursive: true })
  const outPath = path.join(dir, videoFilename(event_name, seq))

  try {
    await download(video_url, inMp4)

    const hasOverlay = typeof overlay_png === 'string' && overlay_png.length > 0
    if (hasOverlay) {
      const b64 = overlay_png.includes(',') ? overlay_png.split(',')[1] : overlay_png
      fs.writeFileSync(overlayPng, Buffer.from(b64, 'base64'))
    }
    await runFfmpeg(buildFfmpegArgs(inMp4, outPath, hasOverlay ? overlayPng : null))
    // Return mp4 bytes langsung → Preview bikin blob URL buat <video>. File tetep ke-save ke
    // disk (arsip). Hemat 1 route static-server. Path final ada di header buat debug/log.
    const bytes = fs.readFileSync(outPath)
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `inline; filename="${path.basename(outPath)}"`,
        'X-Semeta-Path': outPath,
      },
    })
  } catch (err) {
    console.error('[finalize-video] gagal:', err)
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 })
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {/* temp cleanup best-effort */}
  }
}

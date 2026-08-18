import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { proxied } from './facedetect'

// Bikin PNG overlay 2:3 (transparan) buat di-burn ke video via ffmpeg server-side.
// Isi: frame PNG (cover-fit) + QR yang udah di-render jadi PNG, ditaruh persis kayak di Preview
// (pojok kanan atas). Video mentah dari FAL bisa 16:9 → ffmpeg letterbox ke 2:3 (item atas-bawah),
// overlay ini nempel di kanvas 2:3 final. Output transparan biar cuma frame+QR yg keliatan.
//
// Kenapa PNG di client, bukan di ffmpeg: QR = SVG React + frame = branding, dua-duanya konteks UI.
// ffmpeg cukup terima 1 PNG datar. Pisah concern: render di client, encode di server.

const OVERLAY_W = 800   // kanvas 2:3 — cukup buat overlay tajam, ffmpeg scale ke resolusi video
const OVERLAY_H = 1200

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error(`overlay img load failed: ${url.slice(0, 80)}`))
    im.src = proxied(url)
  })
}

// SVG string (dari QRCodeSVG yang di-serialize) → HTMLImageElement lewat data URI.
// qrcode.react kadang emit <svg> TANPA xmlns → <img> nolak ("svg load failed"). Inject kalau kurang.
function loadSvg(svg: string): Promise<HTMLImageElement> {
  const withNs = svg.includes('xmlns')
    ? svg
    : svg.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
  const dataUri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(withNs)))}`
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('QR svg load failed'))
    im.src = dataUri
  })
}

function coverFit(sW: number, sH: number, bW: number, bH: number) {
  const scale = Math.max(bW / sW, bH / sH)
  const dw = Math.round(sW * scale), dh = Math.round(sH * scale)
  return { dx: Math.round((bW - dw) / 2), dy: Math.round((bH - dh) / 2), dw, dh }
}

function toPngDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('overlay toBlob null')); return }
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('overlay FileReader failed'))
      reader.readAsDataURL(blob)
    }, 'image/png')
  })
}

/** QR microsite → SVG string buat di-burn ke video. Di-render dari `url` LANGSUNG, bukan
 *  dibaca dari DOM: QR di layar ada di 4 tempat (inline/fullscreen/print) yang muncul-ilang
 *  ikut state, jadi nyomot dari DOM = balapan sama render. url kosong (upload belum kelar /
 *  unlicensed) → null, buildVideoOverlay skip QR dan frame tetep jalan.
 *  QR-nya sama persis dgn yang di foto & kertas print — satu QR buat ori/ai/video. */
export function qrSvgString(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return renderToStaticMarkup(
      createElement(QRCodeSVG, { value: url, size: 512, level: 'M', includeMargin: true }),
    )
  } catch {
    return null // QR gagal ≠ tamu kehilangan video — overlay lanjut tanpa QR
  }
}

// frameUrl null = video tanpa frame (cuma QR). qrSvg null = tanpa QR (freemium/unlicensed).
// Return PNG dataURL transparan 2:3, atau null kalau dua-duanya kosong (ga ada yg perlu di-burn).
export async function buildVideoOverlay(
  frameUrl: string | null,
  qrSvg: string | null,
): Promise<string | null> {
  if (!frameUrl && !qrSvg) return null
  const canvas = document.createElement('canvas')
  canvas.width = OVERLAY_W
  canvas.height = OVERLAY_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  if (frameUrl) {
    // Frame gagal load JANGAN matiin overlay (fail-safe) — QR bisa tetep ke-burn tanpa frame.
    try {
      const frame = await loadImg(frameUrl)
      const { dx, dy, dw, dh } = coverFit(frame.naturalWidth, frame.naturalHeight, OVERLAY_W, OVERLAY_H)
      ctx.drawImage(frame, dx, dy, dw, dh)
    } catch { /* frame skip — QR-only overlay */ }
  }
  if (qrSvg) {
    // QR gagal render (SVG malformed/kosong) JANGAN matiin overlay — skip QR, frame tetep jalan.
    // Konsisten fail-safe video path: gagal QR ≠ tamu kehilangan video.
    try {
      const qr = await loadSvg(qrSvg)
      // Pojok kanan atas + white plate, sama posisi kayak QR di Preview. Ukuran ~13% lebar kanvas.
      const qrSize = Math.round(OVERLAY_W * 0.15)
      const pad = Math.round(OVERLAY_W * 0.03)
      const plate = qrSize + pad
      const x = OVERLAY_W - plate - pad
      const y = pad
      ctx.fillStyle = '#fff'
      ctx.fillRect(x, y, plate, plate)
      ctx.drawImage(qr, x + pad / 2, y + pad / 2, qrSize, qrSize)
    } catch { /* QR skip — frame-only overlay (atau null di bawah kalau frame juga kosong) */ }
  }
  return toPngDataUrl(canvas)
}

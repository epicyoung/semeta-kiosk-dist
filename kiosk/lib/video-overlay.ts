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
function loadSvg(svg: string): Promise<HTMLImageElement> {
  const dataUri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
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
    const frame = await loadImg(frameUrl)
    const { dx, dy, dw, dh } = coverFit(frame.naturalWidth, frame.naturalHeight, OVERLAY_W, OVERLAY_H)
    ctx.drawImage(frame, dx, dy, dw, dh)
  }
  if (qrSvg) {
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
  }
  return toPngDataUrl(canvas)
}

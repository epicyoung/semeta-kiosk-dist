import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { proxied } from './facedetect'

// Bikin PNG overlay 2:3 (transparan) buat di-burn ke video via ffmpeg server-side.
// Isi: frame PNG (cover-fit). QR TIDAK di-burn ke video — QR sudah ada di screen kiosk,
// di kertas print, dan di microsite delivery. Video MP4 harus bersih dari QR.
//
// Kenapa PNG di client, bukan di ffmpeg: frame = branding konteks UI.
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

// SVG string helper buat kebutuhan serialisasi SVG QR jika diperlukan di tempat lain.
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

/** QR microsite → SVG string jika diperlukan */
export function qrSvgString(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return renderToStaticMarkup(
      createElement(QRCodeSVG, { value: url, size: 512, level: 'M', includeMargin: true }),
    )
  } catch {
    return null
  }
}

// frameUrl null = video tanpa frame (mentah).
// Return PNG dataURL transparan 2:3, atau null kalau frame kosong.
// Note: _qrSvg diabaikan karena QR TIDAK boleh masuk ke dalam video file MP4.
export async function buildVideoOverlay(
  frameUrl: string | null,
  _qrSvg?: string | null,
): Promise<string | null> {
  if (!frameUrl) return null
  const canvas = document.createElement('canvas')
  canvas.width = OVERLAY_W
  canvas.height = OVERLAY_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Frame gagal load JANGAN matiin overlay (fail-safe)
  try {
    const frame = await loadImg(frameUrl)
    const { dx, dy, dw, dh } = coverFit(frame.naturalWidth, frame.naturalHeight, OVERLAY_W, OVERLAY_H)
    ctx.drawImage(frame, dx, dy, dw, dh)
  } catch {
    return null
  }
  return toPngDataUrl(canvas)
}

import { proxied } from './facedetect'
import { fitWithin } from './upload'

// Cover-fit rect: scale src to fully cover box, centered. Overflow = frame edges crop.
// Pure — tested in frame-composite.test.ts.
export function coverFit(srcW: number, srcH: number, boxW: number, boxH: number):
  { dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.max(boxW / srcW, boxH / srcH)
  const dw = Math.round(srcW * scale)
  const dh = Math.round(srcH * scale)
  return { dx: Math.round((boxW - dw) / 2), dy: Math.round((boxH - dh) / 2), dw, dh }
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error(`image load failed: ${url.slice(0, 80)}`))
    im.src = proxied(url)
  })
}

// Encode async via toBlob — JPEG encode jalan off-main-thread (Chrome), UI ga freeze.
// JANGAN ganti ke toDataURL: itu encode SINKRON, nge-block main thread di foto full-res.
function toJpegDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('toBlob returned null')); return }
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('FileReader failed'))
      reader.readAsDataURL(blob)
    }, 'image/jpeg', 0.92)
  })
}

// Burn frame PNG onto photo. maxEdge: SET buat versi upload — uploadAsset toh nge-resize ke
// MAX_PX 1200 sebelum R2, composite langsung di ukuran target jauh lebih murah daripada
// canvas full-res 6000px Canon. Display/print JANGAN pakai maxEdge (kualitas print full-res).
// frameUrl null tanpa maxEdge = passthrough (foto polos).
export async function compositeFrame(
  photoUrl: string, frameUrl: string | null, maxEdge?: number,
): Promise<string> {
  if (!frameUrl && !maxEdge) return photoUrl
  const [photo, frame] = await Promise.all([
    loadImg(photoUrl),
    frameUrl ? loadImg(frameUrl) : Promise.resolve(null),
  ])

  if (!frame) {
    const fit = maxEdge ? fitWithin(photo.naturalWidth, photo.naturalHeight, maxEdge) : null
    const w = fit?.w ?? photo.naturalWidth
    const h = fit?.h ?? photo.naturalHeight
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(photo, 0, 0, w, h)
    return toJpegDataUrl(canvas)
  }

  // Frame ada: Frame menentukan rasio kanvas & batas cetak template (mis. 1200x1800 4R)!
  // Frame TIDAK BOLEH terpotong agar logo/teks/stiker di tepi atas & bawah 100% utuh.
  // Foto tamu yang di-coverFit di belakang jendela frame.
  const baseW = frame.naturalWidth
  const baseH = frame.naturalHeight
  const fit = maxEdge ? fitWithin(baseW, baseH, maxEdge) : null
  const w = fit?.w ?? baseW
  const h = fit?.h ?? baseH

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  // Foto cover-fit memenuhi kanvas di belakang frame
  const { dx, dy, dw, dh } = coverFit(photo.naturalWidth, photo.naturalHeight, w, h)
  ctx.drawImage(photo, dx, dy, dw, dh)

  // Frame digambar 100% utuh di atas foto (zero-crop)
  ctx.drawImage(frame, 0, 0, w, h)

  return toJpegDataUrl(canvas)
}

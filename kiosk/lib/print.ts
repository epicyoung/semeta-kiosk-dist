// Print foto 4R (4×6in) via SATU iframe persisten + window.print().
// Chrome --kiosk-printing → silent ke default printer; tanpa flag → print box Chrome muncul.
// Dua pelajaran event live (2026-07-04), JANGAN diulang:
// 1. JANGAN remove iframe setelah print() — remove saat dialog kebuka bikin Chrome
//    nutup print box-nya sendiri (gejala: "printbox muncul terus ilang").
// 2. JANGAN gantung di iframe.onload — event bisa keburu lewat sebelum handler kepasang,
//    dulu jatuh ke timeout yang resolve TANPA manggil print() (gejala: ga keluar apa-apa).
//    Sekarang: tunggu img.decode() (cap 10s), lalu print() SELALU dipanggil.

import type { PrintSize } from './types'

const FRAME_ID = 'semeta-print-frame'
const DECODE_TIMEOUT_MS = 10_000 // decode nyangkut 10s → print aja, halaman telat lebih baik daripada ga keluar

function getPrintFrame(): HTMLIFrameElement {
  const existing = document.getElementById(FRAME_ID)
  if (existing instanceof HTMLIFrameElement) return existing
  const iframe = document.createElement('iframe')
  iframe.id = FRAME_ID
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:0'
  document.body.appendChild(iframe)
  return iframe
}

async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url
  const blob = await fetch(url).then(r => r.blob())
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target!.result as string)
    reader.onerror = () => reject(new Error('read gagal'))
    reader.readAsDataURL(blob)
  })
}

/** Baca orientasi & dimensi foto dari dataURL. */
function readImageSpec(dataUrl: string): Promise<{ orient: 'portrait' | 'landscape'; width: number; height: number }> {
  return new Promise(resolve => {
    const im = new Image()
    im.onload = () => resolve({
      orient: im.naturalWidth > im.naturalHeight ? 'landscape' : 'portrait',
      width: im.naturalWidth,
      height: im.naturalHeight,
    })
    im.onerror = () => resolve({ orient: 'portrait', width: 1200, height: 1800 })
    im.src = dataUrl
  })
}

/** Tentukan CSS @page size dan dimensi img berdasarkan paperSize atau rasio gambar. */
export function resolvePageStyle(
  spec: { orient: 'portrait' | 'landscape'; width: number; height: number },
  paperSize?: PrintSize
): { page: string; imgSize: string } {
  let size = paperSize

  // Auto-detect jika paperSize tidak disuplai secara eksplisit
  if (!size) {
    const maxD = Math.max(spec.width, spec.height)
    const minD = Math.min(spec.width, spec.height)
    const ratio = minD / (maxD || 1)
    // Rasio ISO 216 A-series (1 : √2) ≈ 0.707 (toleransi 0.68 - 0.73)
    if (ratio > 0.68 && ratio < 0.73) {
      if (maxD > 4200) {
        size = spec.orient === 'landscape' ? 'A3_LANDSCAPE' : 'A3_PORTRAIT'
      } else {
        size = spec.orient === 'landscape' ? 'A4_LANDSCAPE' : 'A4_PORTRAIT'
      }
    }
  }

  if (size === 'A4_PORTRAIT') {
    return { page: 'A4 portrait', imgSize: 'width:210mm;height:297mm' }
  }
  if (size === 'A4_LANDSCAPE') {
    return { page: 'A4 landscape', imgSize: 'width:297mm;height:210mm' }
  }
  if (size === 'A3_PORTRAIT') {
    return { page: 'A3 portrait', imgSize: 'width:297mm;height:420mm' }
  }
  if (size === 'A3_LANDSCAPE') {
    return { page: 'A3 landscape', imgSize: 'width:420mm;height:297mm' }
  }

  const isLandscape = size === '4R_LANDSCAPE' || spec.orient === 'landscape'
  return {
    page: isLandscape ? '6in 4in' : '4in 6in',
    imgSize: isLandscape ? 'width:6in;height:4in' : 'width:4in;height:6in',
  }
}

/** Baca orientasi foto dari dimensi. Landscape → kertas 6×4, portrait → 4×6.
 *  Biar foto landscape ga ke-crop dipaksa masuk kertas portrait (bug lama). */
function readOrientation(dataUrl: string): Promise<'portrait' | 'landscape'> {
  return readImageSpec(dataUrl).then(s => s.orient)
}

/** Print ke queue Windows spesifik lewat /api/print (paper size + 2inch cut sudah
 *  di-preset di queue-nya). Return false = route 501/404/error → caller WAJIB jatuh
 *  ke printPhoto(). Jangan pernah nelen false diam-diam: print ga keluar itu haram. */
export async function printNative(url: string, copies: number, mode: 'strip2' | 'print4r'): Promise<boolean> {
  try {
    const image = await toDataUrl(url)
    const res = await fetch('/api/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, image, copies }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Foto 4R, 2R, A4, atau A3; kertas ikut orientasi & ukuran cetak foto.
 *  Print box Chrome boleh muncul — yang haram: print ga keluar. */
export async function preparePrintImage(url: string, paperSize?: PrintSize, overlayUrl?: string | null, maxEdge?: number) {
  let dataUrl = await toDataUrl(url)
  let spec = await readImageSpec(dataUrl)
  // ISO templates may have a portrait overlay centered on an older landscape canvas.
  // Print the overlay's actual region in its orientation, preserving slot alignment.
  if (overlayUrl && (paperSize?.startsWith('A3_') || paperSize?.startsWith('A4_'))) {
    const overlaySpec = await readImageSpec(await toDataUrl(overlayUrl))
    if (overlaySpec.orient !== spec.orient) {
      const fit = Math.min(spec.width / overlaySpec.width, spec.height / overlaySpec.height)
      const width = overlaySpec.width * fit
      const height = overlaySpec.height * fit
      const source = new Image()
      await new Promise<void>((resolve, reject) => {
        source.onload = () => resolve()
        source.onerror = () => reject(new Error('Print image could not be loaded'))
        source.src = dataUrl
      })
      const canvas = document.createElement('canvas')
      const outputScale = maxEdge ? Math.min(1, maxEdge / Math.max(width, height)) : 1
      canvas.width = Math.round(width * outputScale)
      canvas.height = Math.round(height * outputScale)
      canvas.getContext('2d')!.drawImage(source,
        (spec.width - width) / 2, (spec.height - height) / 2, width, height,
        0, 0, canvas.width, canvas.height)
      dataUrl = canvas.toDataURL('image/jpeg', maxEdge ? 0.88 : 0.95)
      spec = { orient: overlaySpec.orient, width: canvas.width, height: canvas.height }
      paperSize = `${paperSize.startsWith('A3_') ? 'A3' : 'A4'}_${spec.orient === 'portrait' ? 'PORTRAIT' : 'LANDSCAPE'}` as PrintSize
    }
  }
  return { dataUrl, spec, paperSize }
}

export async function printPhoto(url: string, copies: number, paperSize?: PrintSize, overlayUrl?: string | null): Promise<void> {
  const prepared = await preparePrintImage(url, paperSize, overlayUrl)
  const { dataUrl, spec } = prepared
  const { page, imgSize } = resolvePageStyle(spec, prepared.paperSize)
  const iframe = getPrintFrame()
  const doc = iframe.contentDocument!
  doc.open()
  doc.write(`<!DOCTYPE html><html><head><style>
    @page { size: ${page}; margin: 0; }
    * { margin:0; padding:0; box-sizing:border-box; }
    img { ${imgSize}; object-fit:cover; display:block; }
    img + img { page-break-before: always; }
  </style></head><body>${Array.from({ length: copies }, () => `<img src="${dataUrl}" />`).join('')}</body></html>`)
  doc.close()

  // Tunggu foto ke-decode biar halaman ga kosong — tapi jangan pernah nge-block print selamanya.
  const imgs = Array.from(doc.images ?? [])
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.all(imgs.map(img =>
      typeof img.decode === 'function' ? img.decode().catch(() => undefined) : Promise.resolve(),
    )),
    new Promise(r => { timer = setTimeout(r, DECODE_TIMEOUT_MS) }),
  ])
  clearTimeout(timer)
  iframe.contentWindow!.print()
}

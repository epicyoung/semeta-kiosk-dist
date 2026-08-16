// Photo Print — slot math + compose kanvas, semua @300dpi.
// 4R portrait = 4×6in = 1200×1800. 2R = panel strip 2×6in = 600×1800 dan
// SELALU dicetak 2-up di kertas 4R (dua panel identik + garis potong tengah) — printer gak
// pernah ganti media, operator gak perlu utak-atik control panel Windows.
// ponytail: 2R = 2-up only; @page 2x6 langsung kalau suatu saat ada media 2R beneran.
//
// KOORDINAT SLOT BUAT DESAINER OVERLAY (px @300dpi, slot rapet edge-to-edge —
// gutter/border/branding digambar di overlay PNG yang ditaruh DI ATAS foto):
//   4R 1200×1800 — 1: full · 2: atas-bawah 1200×900 · 3: strip 1200×600 · 4: grid 2×2 600×900
//   2R 600×1800 (panel strip) — 1: full · 2: atas-bawah 600×900 · 3: 600×600 · 4: 600×450 (grid 1×N vertikal)
import { coverFit } from './frame-composite'
import { proxied } from './facedetect'
import type { PrintSize, Template } from './types'

export type Rect = { x: number; y: number; w: number; h: number; r?: number }

export const CANVAS_4R_PORTRAIT = { w: 1200, h: 1800 } // 4×6in portrait
export const CANVAS_4R_LANDSCAPE = { w: 1800, h: 1200 } // 6×4in landscape
export const PANEL_2R_STRIP = { w: 600, h: 1800 }   // 2×6in portrait (satu panel)

// Grid rapet kolom×baris. Pure — dites di print-layout.test.mjs.
function grid(cols: number, rows: number, W: number, H: number): Rect[] {
  const w = Math.floor(W / cols)
  const h = Math.floor(H / rows)
  const out: Rect[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: c * w, y: r * h, w, h })
  return out
}

// Preset (cols, rows) per jumlah shot — index 1..4 (0 is unused but kept for 1-based indexing).
const GRID_4R_P: [number, number][] = [[1, 1], [1, 1], [1, 2], [1, 3], [2, 2]]
const GRID_4R_L: [number, number][] = [[1, 1], [1, 1], [2, 1], [3, 1], [2, 2]]
const GRID_2R_S: [number, number][] = [[1, 1], [1, 1], [1, 2], [1, 3], [1, 4]]

/** Kanvas + slot foto per (ukuran cetak, jumlah shot). shots di-clamp 1..4.
 *  Slot > shots (mis. 3 shot di grid 4) → sisa slot dibiarin — overlay yang nutup. */
export function layoutSlots(size: PrintSize, shots: number, customLayout?: { slots: Rect[] } | null): { canvas: { w: number; h: number }; slots: Rect[] } {
  const n = Math.min(4, Math.max(1, Math.trunc(shots) || 1))
  
  let canvas = CANVAS_4R_PORTRAIT
  let gridConfig = GRID_4R_P
  
  if (size === '4R_LANDSCAPE') {
    canvas = CANVAS_4R_LANDSCAPE
    gridConfig = GRID_4R_L
  } else if (size === '2R_STRIP') {
    canvas = PANEL_2R_STRIP
    gridConfig = GRID_2R_S
  }

  if (customLayout?.slots) {
    return { canvas, slots: customLayout.slots }
  }

  const [cols, rows] = gridConfig[n]
  return { canvas, slots: grid(cols, rows, canvas.w, canvas.h).slice(0, n) }
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

// Encode async via toBlob — sama alasannya dgn frame-composite: toDataURL sinkron nge-block main thread.
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

// 2R_STRIP → dua panel strip 2x6 identik di kertas 4R portrait, split tengah + garis potong.
function stamp2Up(panel: HTMLCanvasElement): HTMLCanvasElement {
  const sheet = document.createElement('canvas')
  sheet.width = CANVAS_4R_PORTRAIT.w
  sheet.height = CANVAS_4R_PORTRAIT.h
  const ctx = sheet.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sheet.width, sheet.height)
  // Gambar panel kiri (x=0) dan kanan (x=600)
  ctx.drawImage(panel, 0, 0)
  ctx.drawImage(panel, panel.width, 0)
  // Garis potong putus-putus di tengah
  ctx.strokeStyle = '#bbbbbb'
  ctx.setLineDash([12, 12])
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(panel.width, 0)
  ctx.lineTo(panel.width, sheet.height)
  ctx.stroke()
  return sheet
}

/** 2R only: panel jadi → sheet 4R 2-up buat printer. Digital (QR/email/preview) tetep
 *  pakai panel-nya — tamu jangan dapet file duplikat dua panel + garis potong. */
export async function to2UpSheet(panelUrl: string): Promise<string> {
  const img = await loadImg(panelUrl)
  if (img.naturalWidth === CANVAS_4R_PORTRAIT.w && img.naturalHeight === CANVAS_4R_PORTRAIT.h) {
    return panelUrl
  }
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  c.getContext('2d')!.drawImage(img, 0, 0)
  return toJpegDataUrl(stamp2Up(c))
}

export type SlotTransform = {
  scale?: number
  x?: number
  y?: number
  fit?: 'cover' | 'contain'
  rotation?: number
}

function fitContain(srcW: number, srcH: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / srcW, boxH / srcH)
  const dw = Math.round(srcW * scale)
  const dh = Math.round(srcH * scale)
  return { dx: Math.round((boxW - dw) / 2), dy: Math.round((boxH - dh) / 2), dw, dh }
}

/** N shot + overlay PNG → panel JPEG dataURL (full-res): 4R = 1200×1800 (langsung siap print),
 *  2R = 1050×750 (konten digital; kertas print dibangun via to2UpSheet pas tombol print).
 *  Tiap foto cover-fit + clip ke slot-nya; overlay digambar full-canvas di atasnya. */
export async function composePrintLayout(
  shots: string[],
  // Cuma tiga field ini yang dibaca. Dinarrow-in biar caller non-print (strip AI) bisa nyusun
  // tanpa maksa punya Template utuh — tiap Template tetep memenuhi bentuk ini.
  template: Pick<Template, 'print_size' | 'overlay_url' | 'layout_config'>,
  transforms?: SlotTransform[],
): Promise<string> {
  const size = template.print_size || '4R_PORTRAIT'
  const overlayUrl = template.overlay_url || null
  const { canvas: dims, slots } = layoutSlots(size, shots.length, template.layout_config)
  const [imgs, overlay] = await Promise.all([
    Promise.all(shots.slice(0, slots.length).map(loadImg)),
    overlayUrl ? loadImg(overlayUrl) : Promise.resolve(null),
  ])
  const panel = document.createElement('canvas')
  panel.width = dims.w
  panel.height = dims.h
  const ctx = panel.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, dims.w, dims.h)
  imgs.forEach((img, i) => {
    const s = slots[i]
    const tf = transforms?.[i]
    const fitMode = tf?.fit || 'cover'
    const rotation = (tf?.rotation || 0) % 360

    const isRotated90 = rotation === 90 || rotation === 270
    const effW = isRotated90 ? img.naturalHeight : img.naturalWidth
    const effH = isRotated90 ? img.naturalWidth : img.naturalHeight

    const f = fitMode === 'contain'
      ? fitContain(effW, effH, s.w, s.h)
      : coverFit(effW, effH, s.w, s.h)

    const scale = tf?.scale ?? 1
    const extraDx = (tf?.x ?? 0) * s.w
    const extraDy = (tf?.y ?? 0) * s.h

    ctx.save()
    // Clip ke slot boundaries
    ctx.beginPath()
    ctx.rect(s.x, s.y, s.w, s.h)
    ctx.clip()

    // Move origin ke center slot
    const slotCenterX = s.x + s.w / 2
    const slotCenterY = s.y + s.h / 2
    ctx.translate(slotCenterX + extraDx, slotCenterY + extraDy)

    const totalRotation = ((s.r || 0) + rotation) % 360
    if (totalRotation) {
      ctx.rotate((totalRotation * Math.PI) / 180)
    }

    const drawW = (isRotated90 ? f.dh : f.dw) * scale
    const drawH = (isRotated90 ? f.dw : f.dh) * scale

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH)
    ctx.restore()
  })
  if (overlay) {
    const f = coverFit(overlay.naturalWidth, overlay.naturalHeight, dims.w, dims.h)
    ctx.drawImage(overlay, f.dx, f.dy, f.dw, f.dh)
  }
  return toJpegDataUrl(panel)
}

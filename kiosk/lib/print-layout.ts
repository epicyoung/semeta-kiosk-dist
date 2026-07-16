// Photo Print — slot math + compose kanvas, semua @300dpi.
// 4R portrait = 4×6in = 1200×1800. 2R = panel landscape 3.5×2.5in = 1050×750 dan
// SELALU dicetak 2-up di kertas 4R (dua panel + garis potong) — printer gak pernah
// ganti media, operator gak perlu utak-atik control panel Windows.
// ponytail: 2R = 2-up only; @page 2.5x3.5 langsung kalau suatu saat ada media 2R beneran.
//
// KOORDINAT SLOT BUAT DESAINER OVERLAY (px @300dpi, slot rapet edge-to-edge —
// gutter/border/branding digambar di overlay PNG yang ditaruh DI ATAS foto):
//   4R 1200×1800 — 1: full · 2: atas-bawah 1200×900 · 3: strip 1200×600 · 4: grid 2×2 600×900 · 5-6: grid 2×3 600×600
//   2R 1050×750  — 1: full · 2: kiri-kanan 525×750 · 3: strip 350×750 · 4: grid 2×2 525×375 · 5-6: grid 3×2 350×375
import { coverFit } from './frame-composite'
import { proxied } from './facedetect'
import type { PrintSize } from './types'

export type Rect = { x: number; y: number; w: number; h: number }

export const CANVAS_4R = { w: 1200, h: 1800 } // 4×6in portrait
export const PANEL_2R = { w: 1050, h: 750 }   // 3.5×2.5in landscape (satu panel)

// Grid rapet kolom×baris. Pure — dites di print-layout.test.mjs.
function grid(cols: number, rows: number, W: number, H: number): Rect[] {
  const w = Math.floor(W / cols)
  const h = Math.floor(H / rows)
  const out: Rect[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: c * w, y: r * h, w, h })
  return out
}

// Preset (cols, rows) per jumlah shot — index 1..6, di-clamp.
const GRID_4R: [number, number][] = [[1, 1], [1, 1], [1, 2], [1, 3], [2, 2], [2, 3], [2, 3]]
const GRID_2R: [number, number][] = [[1, 1], [1, 1], [2, 1], [3, 1], [2, 2], [3, 2], [3, 2]]

/** Kanvas + slot foto per (ukuran cetak, jumlah shot). shots di-clamp 1..6.
 *  Slot > shots (mis. 5 shot di grid 6) → sisa slot dibiarin — overlay yang nutup. */
export function layoutSlots(size: PrintSize, shots: number): { canvas: { w: number; h: number }; slots: Rect[] } {
  const n = Math.min(6, Math.max(1, Math.trunc(shots) || 1))
  const canvas = size === '2R' ? PANEL_2R : CANVAS_4R
  const [cols, rows] = (size === '2R' ? GRID_2R : GRID_4R)[n]
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

// 2R → dua panel landscape identik di kertas 4R portrait, centered + garis potong putus-putus.
function stamp2Up(panel: HTMLCanvasElement): HTMLCanvasElement {
  const sheet = document.createElement('canvas')
  sheet.width = CANVAS_4R.w
  sheet.height = CANVAS_4R.h
  const ctx = sheet.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sheet.width, sheet.height)
  const x = Math.round((CANVAS_4R.w - panel.width) / 2)
  const yTop = Math.round((CANVAS_4R.h - panel.height * 2) / 2)
  ctx.drawImage(panel, x, yTop)
  ctx.drawImage(panel, x, yTop + panel.height)
  ctx.strokeStyle = '#bbbbbb'
  ctx.setLineDash([12, 12])
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, yTop + panel.height)
  ctx.lineTo(sheet.width, yTop + panel.height)
  ctx.stroke()
  return sheet
}

/** 2R only: panel jadi → sheet 4R 2-up buat printer. Digital (QR/email/preview) tetep
 *  pakai panel-nya — tamu jangan dapet file duplikat dua panel + garis potong. */
export async function to2UpSheet(panelUrl: string): Promise<string> {
  const img = await loadImg(panelUrl)
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  c.getContext('2d')!.drawImage(img, 0, 0)
  return toJpegDataUrl(stamp2Up(c))
}

/** N shot + overlay PNG → panel JPEG dataURL (full-res): 4R = 1200×1800 (langsung siap print),
 *  2R = 1050×750 (konten digital; kertas print dibangun via to2UpSheet pas tombol print).
 *  Tiap foto cover-fit + clip ke slot-nya; overlay digambar full-canvas di atasnya. */
export async function composePrintLayout(shots: string[], overlayUrl: string | null, size: PrintSize): Promise<string> {
  const { canvas: dims, slots } = layoutSlots(size, shots.length)
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
    const f = coverFit(img.naturalWidth, img.naturalHeight, s.w, s.h)
    // Clip ke slot — overflow cover-fit gak boleh nimpa slot sebelah
    ctx.save()
    ctx.beginPath()
    ctx.rect(s.x, s.y, s.w, s.h)
    ctx.clip()
    ctx.drawImage(img, s.x + f.dx, s.y + f.dy, f.dw, f.dh)
    ctx.restore()
  })
  if (overlay) {
    const f = coverFit(overlay.naturalWidth, overlay.naturalHeight, dims.w, dims.h)
    ctx.drawImage(overlay, f.dx, f.dy, f.dw, f.dh)
  }
  return toJpegDataUrl(panel)
}

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
import type { PrintSize, Template, Ai4RLayout } from './types'

export type Rect = { x: number; y: number; w: number; h: number; r?: number }

export const CANVAS_4R_PORTRAIT = { w: 1200, h: 1800 } // 4×6in portrait
export const CANVAS_4R_LANDSCAPE = { w: 1800, h: 1200 } // 6×4in landscape
export const PANEL_2R_STRIP = { w: 600, h: 1800 }   // 2×6in portrait (satu panel)
export const CANVAS_A4_PORTRAIT = { w: 2480, h: 3508 } // A4 portrait @300dpi (210×297mm)
export const CANVAS_A4_LANDSCAPE = { w: 3508, h: 2480 } // A4 landscape @300dpi (297×210mm)
export const CANVAS_A3_PORTRAIT = { w: 3508, h: 4960 } // A3 portrait @300dpi (297×420mm)
export const CANVAS_A3_LANDSCAPE = { w: 4960, h: 3508 } // A3 landscape @300dpi (420×297mm)

export function canvasForPrintSize(size: PrintSize): { w: number; h: number } {
  switch (size) {
    case '4R_LANDSCAPE': return CANVAS_4R_LANDSCAPE
    case '2R_STRIP': return PANEL_2R_STRIP
    case 'A4_PORTRAIT': return CANVAS_A4_PORTRAIT
    case 'A4_LANDSCAPE': return CANVAS_A4_LANDSCAPE
    case 'A3_PORTRAIT': return CANVAS_A3_PORTRAIT
    case 'A3_LANDSCAPE': return CANVAS_A3_LANDSCAPE
    case '4R_PORTRAIT':
    default:
      return CANVAS_4R_PORTRAIT
  }
}

export const PRINT_DPI = 300

/** mm → px @300dpi. Desainer ngomong mm, kanvas ngomong px; konversi ditaruh di satu tempat
 *  biar angka ajaib kayak 638 ga bertebaran di kode. */
export function mmToPx(mm: number): number {
  return Math.round((mm / 25.4) * PRINT_DPI)
}

/** Kartu nama 54×85mm — ukuran baku kartu event. 54/85 = 0.635, BUKAN 2:3 (0.667): output AI
 *  2:3 ga akan pernah pas persis di sini, selalu ada ~5% yang kepotong. Itu disengaja dan
 *  justru yang bikin slider komposisi ada gunanya — lihat CARD_2UP_NOTE di bawah. */
export const CARD_MM = { w: 54, h: 85 }

/** Luberan 3mm ke LUAR kertas di sisi yang mepet tepi (mode 'corner').
 *
 *  Kenapa perlu padahal kartunya udah mentok x=0/y=0: feed printer dye-sub meleset
 *  ±0.5–1mm tiap lembar. Foto yang berhenti persis di tepi kanvas bakal nyisain pita
 *  putih tipis pas feed-nya geser ke dalam — dan itu kejadian di sisi yang justru GA
 *  dipotong, jadi ga bisa diselamatin. Dengan luber keluar, tepinya dijamin penuh tinta.
 *  Yang di luar kanvas dibuang sendiri sama clip di composePrintLayout — ga ada efek lain. */
export const CARD_OVERSCAN_MM = 3

/** Mode penempatan dua kartu di kertas.
 *   'corner' = mepet pojok kiri-atas, dua kartu nempel. Cuma butuh 3 potongan lurus
 *              (kanan, bawah, tengah) karena kiri & atas udah jadi tepi kertas.
 *              WAJIB printer borderless — kalau printer nyisain margin putih, sisi kiri
 *              & atas bakal putih dan ga bisa dipotong.
 *   'center' = dua kartu di tengah kertas, ada gutter. Butuh 4+ potongan, tapi aman di
 *              printer apa pun. */
export type CardAnchor = 'corner' | 'center'

/** Dua kartu 54×85mm berdampingan di 4R landscape (1800×1200): satu Original, satu AI.
 *
 *  Pure — dites di __tests__/print-layout.test.ts. Hasilnya dipakai sebagai `layout_config.slots`,
 *  jadi jalur render/compose-nya persis sama kayak slot custom dari LayoutDesigner; ga ada
 *  cabang kode baru di composePrintLayout.
 *
 *  Di mode 'corner' kotak yang dibalikin sengaja MELUBER keluar kanvas (x/y negatif) di sisi
 *  kiri & atas — lihat CARD_OVERSCAN_MM. Garis potongnya tetep di 54×85 persis; pakai
 *  cardTrimBoxes() buat dapet itu.
 *
 *  CARD_2UP_NOTE — kenapa hasilnya perlu di-nudge: foto 2:3 di-`cover` ke slot kartu
 *  ke-scale by height, jadi lebarnya lewat dan kepotong kiri-kanan, sementara vertikalnya
 *  PAS. Artinya di scale=1 ga ada ruang gerak naik-turun sama sekali; operator yang mau
 *  geser komposisi vertikal harus zoom dikit dulu (scale > 1) — StripComposer udah nyediain
 *  pinch/wheel buat itu. Ini bukan bug, ini konsekuensi 54×85 ≠ 2:3. */
export function cardTwoUpSlots(
  canvas: { w: number; h: number } = CANVAS_4R_LANDSCAPE,
  anchor: CardAnchor = 'corner',
  gutterMm = 5,
): Rect[] {
  const trims = cardTrimBoxes(canvas, anchor, gutterMm)
  if (anchor === 'center') return trims
  // corner: luberin cuma ke sisi yang nempel tepi kertas. Kartu kiri luber ke kiri+atas,
  // kartu kanan cuma ke atas — sisi dalemnya ketemu kartu sebelah, bukan tepi kertas.
  const over = mmToPx(CARD_OVERSCAN_MM)
  return trims.map((t, i) => ({
    x: i === 0 ? t.x - over : t.x,
    y: t.y - over,
    w: i === 0 ? t.w + over : t.w,
    h: t.h + over,
  }))
}

/** Garis potong = ukuran kartu JADI (54×85mm), pasangannya cardTwoUpSlots dengan argumen
 *  yang sama. Dipakai buat gambar garis bantu potong dan buat ngecek posisi lubang di
 *  overlay PNG. Sengaja dipisah dari kotak foto biar "mana yang kepotong" ga pernah jadi
 *  tebak-tebakan. */
export function cardTrimBoxes(
  canvas: { w: number; h: number } = CANVAS_4R_LANDSCAPE,
  anchor: CardAnchor = 'corner',
  gutterMm = 5,
): Rect[] {
  const w = mmToPx(CARD_MM.w)
  const h = mmToPx(CARD_MM.h)
  const gutter = anchor === 'corner' ? 0 : mmToPx(gutterMm)
  const x0 = anchor === 'corner' ? 0 : Math.round((canvas.w - (w * 2 + gutter)) / 2)
  const y0 = anchor === 'corner' ? 0 : Math.round((canvas.h - h) / 2)
  return [
    { x: x0, y: y0, w, h },
    { x: x0 + w + gutter, y: y0, w, h },
  ]
}

/** Jalur pisau buat mode 'corner': 3 garis lurus. Dibalikin sebagai garis penuh
 *  (x1,y1)-(x2,y2) supaya pemotongnya bisa naruh penggaris lurus dari tepi ke tepi —
 *  garis sepanjang kartu doang bikin operator nebak terusannya. */
export function cardCutLines(
  canvas: { w: number; h: number } = CANVAS_4R_LANDSCAPE,
  anchor: CardAnchor = 'corner',
  gutterMm = 5,
): { x1: number; y1: number; x2: number; y2: number }[] {
  const [left, right] = cardTrimBoxes(canvas, anchor, gutterMm)
  const lines = [
    // tengah: pisahin dua kartu
    { x1: left.x + left.w, y1: 0, x2: left.x + left.w, y2: canvas.h },
    // bawah: buang sisa bawah
    { x1: 0, y1: left.y + left.h, x2: canvas.w, y2: left.y + left.h },
    // kanan: buang sisa kanan
    { x1: right.x + right.w, y1: 0, x2: right.x + right.w, y2: canvas.h },
  ]
  if (anchor === 'corner') return lines
  // center: dua sisi lagi (kiri & atas) yang di mode corner udah jadi tepi kertas
  return [
    ...lines,
    { x1: left.x, y1: 0, x2: left.x, y2: canvas.h },
    { x1: 0, y1: left.y, x2: canvas.w, y2: left.y },
  ]
}

/** Jumlah slot yang dirender StripComposer buat satu mode. SATU sumber kebenaran: dipakai
 *  buat render, hitung slot kepakai, DAN pas pindah tab. Dulu dua tempat ngitung sendiri-sendiri
 *  dan beda pas ai4rLayout bukan 4-slot (SINGLE_1/SPLIT_2/TRIO_3) — foto ke-2 nyangkut di
 *  index yang ga pernah kebaca: ga kerender, ga keprint, tapi kartunya kelihatan kepakai. */
export function composerSlotCount(
  mode: '2R_STRIP' | '4R_LANDSCAPE',
  opts: {
    slots: number
    ai4rLayout?: Ai4RLayout
    customSlotCount?: number
    custom4rSlotCount?: number
  },
): number {
  if (mode === '4R_LANDSCAPE') {
    if (opts.custom4rSlotCount) return opts.custom4rSlotCount
    switch (opts.ai4rLayout) {
      case 'SINGLE_1': return 1
      case 'SPLIT_2': return 2
      case 'TRIO_3':
      case 'GRID_3': return 3
      default: return 4
    }
  }
  return opts.customSlotCount || opts.slots
}

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
export function layoutSlots(
  size: PrintSize,
  shots: number,
  customLayout?: { slots: Rect[] } | null,
  ai4rLayout?: Ai4RLayout
): { canvas: { w: number; h: number }; slots: Rect[] } {
  if (customLayout?.slots) {
    return { canvas: canvasForPrintSize(size), slots: customLayout.slots }
  }

  if (size === '4R_PORTRAIT' && ai4rLayout) {
    const canvas = CANVAS_4R_PORTRAIT
    if (ai4rLayout === 'SINGLE_1') {
      return { canvas, slots: [{ x: 0, y: 0, w: 1200, h: 1800 }] }
    }
    if (ai4rLayout === 'TRIO_3') {
      return {
        canvas,
        slots: [
          { x: 0, y: 0, w: 1200, h: 900 },      // Atas Tidur (Landscape Hero)
          { x: 0, y: 900, w: 600, h: 900 },     // Bawah Kiri Berdiri (Portrait)
          { x: 600, y: 900, w: 600, h: 900 },   // Bawah Kanan Berdiri (Portrait)
        ],
      }
    }
    if (ai4rLayout === 'GRID_3') {
      return {
        canvas,
        slots: [
          { x: 0, y: 0, w: 1200, h: 600 },
          { x: 0, y: 600, w: 1200, h: 600 },
          { x: 0, y: 1200, w: 1200, h: 600 },
        ],
      }
    }
    if (ai4rLayout === 'SPLIT_2') {
      return {
        canvas,
        slots: [
          { x: 0, y: 0, w: 1200, h: 900 },
          { x: 0, y: 900, w: 1200, h: 900 },
        ],
      }
    }
    if (ai4rLayout === 'GRID_4') {
      return {
        canvas,
        slots: [
          { x: 0, y: 0, w: 600, h: 900 },
          { x: 600, y: 0, w: 600, h: 900 },
          { x: 0, y: 900, w: 600, h: 900 },
          { x: 600, y: 900, w: 600, h: 900 },
        ],
      }
    }
  }

  if (size === '4R_LANDSCAPE' && ai4rLayout) {
    const canvas = CANVAS_4R_LANDSCAPE
    if (ai4rLayout === 'SINGLE_1') {
      return { canvas, slots: [{ x: 0, y: 0, w: 1800, h: 1200 }] }
    }
    if (ai4rLayout === 'TRIO_3') {
      return {
        canvas,
        slots: [
          { x: 0, y: 0, w: 900, h: 1200 },       // Kiri Berdiri (Portrait)
          { x: 900, y: 0, w: 900, h: 600 },      // Kanan Atas Tidur (Landscape)
          { x: 900, y: 600, w: 900, h: 600 },    // Kanan Bawah Tidur (Landscape)
        ],
      }
    }
    if (ai4rLayout === 'GRID_3') {
      return {
        canvas,
        slots: [
          { x: 0, y: 0, w: 600, h: 1200 },
          { x: 600, y: 0, w: 600, h: 1200 },
          { x: 1200, y: 0, w: 600, h: 1200 },
        ],
      }
    }
    if (ai4rLayout === 'SPLIT_2') {
      return {
        canvas,
        slots: [
          { x: 0, y: 0, w: 900, h: 1200 },
          { x: 900, y: 0, w: 900, h: 1200 },
        ],
      }
    }
    if (ai4rLayout === 'GRID_4') {
      return {
        canvas,
        slots: [
          { x: 0, y: 0, w: 900, h: 600 },
          { x: 900, y: 0, w: 900, h: 600 },
          { x: 0, y: 600, w: 900, h: 600 },
          { x: 900, y: 600, w: 900, h: 600 },
        ],
      }
    }
  }

  const n = Math.min(4, Math.max(1, Math.trunc(shots) || 1))
  const canvas = canvasForPrintSize(size)
  const isLandscape = size === '4R_LANDSCAPE' || size === 'A4_LANDSCAPE' || size === 'A3_LANDSCAPE'
  const isStrip = size === '2R_STRIP'
  const gridConfig = isStrip ? GRID_2R_S : isLandscape ? GRID_4R_L : GRID_4R_P

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

// 2R_STRIP → dua panel strip 2x6 di kertas 4R portrait, split tengah + garis potong.
// Mendukung:
// 1. Full 1200x1800 single-file overlay (desain kiri & kanan langsung jadi satu file).
// 2. Dual panel terpisah (kiri & kanan beda file 600x1800).
// 3. Single strip panel 600x1800 (kiri & kanan identik).
function stamp2Up(leftPanel: HTMLCanvasElement, rightPanel?: HTMLCanvasElement, fullOverlay?: HTMLImageElement | null): HTMLCanvasElement {
  const sheet = document.createElement('canvas')
  sheet.width = CANVAS_4R_PORTRAIT.w
  sheet.height = CANVAS_4R_PORTRAIT.h
  const ctx = sheet.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sheet.width, sheet.height)
  // Gambar panel kiri (x=0) dan kanan (x=600)
  ctx.drawImage(leftPanel, 0, 0)
  ctx.drawImage(rightPanel || leftPanel, leftPanel.width, 0)
  // Garis potong putus-putus di tengah
  ctx.strokeStyle = '#bbbbbb'
  ctx.setLineDash([12, 12])
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(leftPanel.width, 0)
  ctx.lineTo(leftPanel.width, sheet.height)
  ctx.stroke()

  // Jika ada full 1200x1800 sheet overlay, gambar langsung full bleed di atas kedua strip
  if (fullOverlay && fullOverlay.naturalWidth > fullOverlay.naturalHeight * 0.45) {
    const f = coverFit(fullOverlay.naturalWidth, fullOverlay.naturalHeight, sheet.width, sheet.height)
    ctx.drawImage(fullOverlay, f.dx, f.dy, f.dw, f.dh)
  }

  return sheet
}

/** 2R only: panel jadi → sheet 4R 2-up buat printer. Digital (QR/email/preview) tetep
 *  pakai panel-nya — tamu jangan dapet file duplikat dua panel + garis potong. */
export async function to2UpSheet(
  leftPanelUrl: string,
  rightPanelUrl?: string | null,
  fullOverlayUrl?: string | null
): Promise<string> {
  const [leftImg, rightImg, fullOverlayImg] = await Promise.all([
    loadImg(leftPanelUrl),
    rightPanelUrl ? loadImg(rightPanelUrl) : Promise.resolve(null),
    fullOverlayUrl ? loadImg(fullOverlayUrl) : Promise.resolve(null),
  ])
  if (!rightImg && !fullOverlayImg && leftImg.naturalWidth === CANVAS_4R_PORTRAIT.w && leftImg.naturalHeight === CANVAS_4R_PORTRAIT.h) {
    return leftPanelUrl
  }
  const leftCanvas = document.createElement('canvas')
  leftCanvas.width = leftImg.naturalWidth
  leftCanvas.height = leftImg.naturalHeight
  leftCanvas.getContext('2d')!.drawImage(leftImg, 0, 0)

  let rightCanvas: HTMLCanvasElement | undefined
  if (rightImg) {
    rightCanvas = document.createElement('canvas')
    rightCanvas.width = rightImg.naturalWidth
    rightCanvas.height = rightImg.naturalHeight
    rightCanvas.getContext('2d')!.drawImage(rightImg, 0, 0)
  }

  return toJpegDataUrl(stamp2Up(leftCanvas, rightCanvas, fullOverlayImg))
}

/** 2-Strip 4R Sheet Compositor: Menggabungkan foto slot + overlay 1200x1800 full sheet (atau dual strip 600x1800)
 *  langsung ke kanvas 4R portrait tanpa duplikasi tumpang-tindih. */
export async function compose2UpSheet(
  shots: string[],
  transforms?: SlotTransform[],
  overlayUrl?: string | null,
  overlayRightUrl?: string | null,
  customLayout?: { slots: Rect[] } | null,
): Promise<string> {
  const { slots: baseSlots } = layoutSlots('2R_STRIP', shots.length, customLayout)

  const [imgs, leftOverlay, rightOverlay] = await Promise.all([
    Promise.all(shots.slice(0, baseSlots.length).map(loadImg)),
    overlayUrl ? loadImg(overlayUrl) : Promise.resolve(null),
    overlayRightUrl ? loadImg(overlayRightUrl) : Promise.resolve(null),
  ])

  const sheet = document.createElement('canvas')
  sheet.width = CANVAS_4R_PORTRAIT.w // 1200
  sheet.height = CANVAS_4R_PORTRAIT.h // 1800
  const ctx = sheet.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sheet.width, sheet.height)

  // Gambar foto slot di kedua strip: Strip 1 (offsetX = 0) dan Strip 2 (offsetX = 600)
  const stripOffsets = [0, CANVAS_4R_PORTRAIT.w / 2]

  stripOffsets.forEach(offsetX => {
    imgs.forEach((img, i) => {
      const s = baseSlots[i]
      const tf = transforms?.[i]
      const fitMode = tf?.fit || 'cover'
      const rotation = (tf?.rotation || 0) % 360

      const isRotated90 = rotation === 90 || rotation === 270
      const effW = isRotated90 ? img.naturalHeight : img.naturalWidth
      const effH = isRotated90 ? img.naturalWidth : img.naturalHeight

      const f = fitAxis(effW, effH, s.w, s.h, fitMode)

      const scale = tf?.scale ?? 1
      const extraDx = (tf?.x ?? 0) * s.w
      const extraDy = (tf?.y ?? 0) * s.h

      ctx.save()
      ctx.beginPath()
      ctx.rect(offsetX + s.x, s.y, s.w, s.h)
      ctx.clip()

      const slotCenterX = offsetX + s.x + s.w / 2
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
  })

  // Garis potong putus-putus tengah
  ctx.strokeStyle = '#bbbbbb'
  ctx.setLineDash([12, 12])
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(CANVAS_4R_PORTRAIT.w / 2, 0)
  ctx.lineTo(CANVAS_4R_PORTRAIT.w / 2, sheet.height)
  ctx.stroke()
  ctx.setLineDash([])

  // Pasang Overlay di atas foto
  if (leftOverlay) {
    const isFullSheet = leftOverlay.naturalWidth > leftOverlay.naturalHeight * 0.45 && !rightOverlay
    if (isFullSheet) {
      // 1200x1800 Full Sheet Overlay (Canva/Photoshop): cover full-bleed seluruh kanvas 4R
      const f = coverFit(leftOverlay.naturalWidth, leftOverlay.naturalHeight, sheet.width, sheet.height)
      ctx.drawImage(leftOverlay, f.dx, f.dy, f.dw, f.dh)
    } else {
      // Single/Dual 600x1800 strips:
      // Strip Kiri (x=0..600)
      const fL = coverFit(leftOverlay.naturalWidth, leftOverlay.naturalHeight, 600, 1800)
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, 600, 1800)
      ctx.clip()
      ctx.drawImage(leftOverlay, fL.dx, fL.dy, fL.dw, fL.dh)
      ctx.restore()

      // Strip Kanan (x=600..1200)
      const rImg = rightOverlay || leftOverlay
      const fR = coverFit(rImg.naturalWidth, rImg.naturalHeight, 600, 1800)
      ctx.save()
      ctx.beginPath()
      ctx.rect(600, 0, 600, 1800)
      ctx.clip()
      ctx.drawImage(rImg, 600 + fR.dx, fR.dy, fR.dw, fR.dh)
      ctx.restore()
    }
  }

  return toJpegDataUrl(sheet)
}

export type SlotTransform = {
  scale?: number
  x?: number
  y?: number
  // Sumbu mana yang dipaskan ke slot.
  //   'cover'  = DEFAULT: pilih sumbu yang NUTUP slot, sisi lebihnya kepotong — nol pita
  //              transparan. Slot custom dari overlay operator hampir ga pernah pas 2:3,
  //              jadi 'width' sebagai default bikin tiap cetak butuh double-tap manual dulu.
  //   'width'  = lebar foto = lebar slot, atas-bawah boleh nyisa (foto keliatan UTUH)
  //   'height' = kebalikannya
  // Dulu cover sengaja DIHINDARI: "tamu ga bisa nebak hasilnya sebelum nge-tap". Itu bener
  // pas cover cuma bisa dicapai lewat tap. Sekarang cover jadi default yang KELIATAN di
  // preview sejak awal — ga ada yang perlu ditebak, dan double-tap tetep nyediain dua mode
  // utuh buat yang emang ga mau kepotong.
  fit?: 'cover' | 'width' | 'height'
  rotation?: number
}

/** Paskan satu sumbu ke slot, sumbu lain ngikut rasio. Ke-center dua-duanya; yang lewat
 *  slot dipotong sama clip di composePrintLayout.
 *  'cover' = pilih skala TERBESAR dari dua sumbu → slot ketutup penuh. */
export function fitAxis(srcW: number, srcH: number, boxW: number, boxH: number, axis: 'cover' | 'width' | 'height') {
  const scale = axis === 'cover'
    ? Math.max(boxW / srcW, boxH / srcH)
    : axis === 'width' ? boxW / srcW : boxH / srcH
  const dw = Math.round(srcW * scale)
  const dh = Math.round(srcH * scale)
  return { dx: Math.round((boxW - dw) / 2), dy: Math.round((boxH - dh) / 2), dw, dh }
}

/** N shot + overlay PNG → panel JPEG dataURL (full-res): 4R = 1200×1800 (langsung siap print),
 *  2R = 1050×750 (konten digital; kertas print dibangun via to2UpSheet pas tombol print).
 *  Tiap foto cover-fit + clip ke slot-nya; overlay digambar full-canvas di atasnya.
 *
 *  `cutLines` opsional (mis. dari cardCutLines()) — garis bantu potong, digambar paling
 *  akhir. Cuma buat lembar CETAK; jangan dikirim ke output digital/QR, tamu ga butuh
 *  liat jalur pisau di foto mereka. */
export async function composePrintLayout(
  shots: string[],
  template: Pick<Template, 'print_size' | 'overlay_url' | 'layout_config'>,
  transforms?: SlotTransform[],
  ai4rLayout?: Ai4RLayout,
  cutLines?: { x1: number; y1: number; x2: number; y2: number }[],
): Promise<string> {
  const size = template.print_size || '4R_PORTRAIT'
  const overlayUrl = template.overlay_url || null
  const { canvas: dims, slots } = layoutSlots(size, shots.length, template.layout_config, ai4rLayout)
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

    const f = fitAxis(effW, effH, s.w, s.h, fitMode)

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
    if (size === '2R_STRIP' && overlay.naturalWidth > overlay.naturalHeight * 0.45) {
      // Overlay adalah full 1200x1800 sheet: ambil separuh kiri untuk panel strip digital
      const halfW = overlay.naturalWidth / 2
      ctx.drawImage(overlay, 0, 0, halfW, overlay.naturalHeight, 0, 0, dims.w, dims.h)
    } else {
      const overlayScale = size === '2R_STRIP'
        ? Math.max(dims.w / overlay.naturalWidth, dims.h / overlay.naturalHeight)
        : Math.min(dims.w / overlay.naturalWidth, dims.h / overlay.naturalHeight)
      const dw = overlay.naturalWidth * overlayScale
      const dh = overlay.naturalHeight * overlayScale
      const f = { dx: (dims.w - dw) / 2, dy: (dims.h - dh) / 2, dw, dh }
      ctx.drawImage(overlay, f.dx, f.dy, f.dw, f.dh)
    }
  }
  // Garis potong DI ATAS overlay: gunanya buat manusia yang megang pisau, jadi dia harus
  // keliatan walau overlay-nya full-bleed. Digambar terakhir dengan alasan yang sama.
  if (cutLines?.length) drawCutGuides(ctx, cutLines)
  return toJpegDataUrl(panel)
}

/** Garis bantu potong putus-putus. Abu-abu tipis: kebaca operator, tapi kalau kepotongnya
 *  meleset dikit ga bikin garis hitam tebal nempel di kartu tamu. */
export function drawCutGuides(
  ctx: CanvasRenderingContext2D,
  lines: { x1: number; y1: number; x2: number; y2: number }[],
): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.setLineDash([12, 12])
  ctx.lineWidth = 2
  for (const l of lines) {
    ctx.beginPath()
    ctx.moveTo(l.x1, l.y1)
    ctx.lineTo(l.x2, l.y2)
    ctx.stroke()
  }
  ctx.restore()
}

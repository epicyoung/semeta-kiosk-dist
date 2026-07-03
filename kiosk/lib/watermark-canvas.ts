// Client-side watermark burn for the LOCAL exits (print + save-to-disk). Tiles text
// diagonally into the pixels of a dataURL, no PNG file on disk to delete.
//
// ponytail ceiling: this runs in the browser, so an operator who patches the JS can skip
// it — it's a DETERRENT for the local copies, NOT enforcement. The real, un-bypassable gate
// is the worker burning the R2/guest copy (server-decided, see worker /api/upload). Anyone
// able to patch this bundle is the same population able to extract the secret — out of scope.
//
// Single source of truth: callers must burn ONCE and feed the SAME burned dataURL to
// preview + print + save. Burning per-exit risks a clean paper copy while the screen shows
// a watermark (the two-canvas bug).

// Tile logo spin.png — SAMA seperti watermark R2 (worker/src/watermark.ts). Konstanta
// dicocokin ke sana biar desktop & QR-copy identik: 20% lebar, opacity 0.25, gap 60%.
const WM_LOGO_SRC = "/spin.png"
const WM_ANGLE = -35 * (Math.PI / 180)
const WM_TILE_SCALE = 0.20   // lebar 1 tile logo = 20% lebar foto (match WATERMARK_TILE_SCALE)
const WM_OPACITY = 0.25       // match WATERMARK_OPACITY
const WM_GAP_RATIO = 0.6      // jarak antar-tile = 60% lebar tile (match WATERMARK_GAP_RATIO)

/**
 * Returns a new JPEG dataURL with the watermark tiled over `dataUrl`.
 * If anything fails, returns the original dataURL (never block delivery on a draw error).
 */
export async function burnWatermark(dataUrl: string): Promise<string> {
  try {
    const img = await loadImage(dataUrl)
    const canvas = document.createElement("canvas")
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return dataUrl

    ctx.drawImage(img, 0, 0)

    // Load logo tile; kalau gagal → kirim foto asli (jangan block delivery on missing asset).
    const logo = await loadImage(WM_LOGO_SRC)
    const tileW = Math.round(canvas.width * WM_TILE_SCALE)
    const tileH = Math.round(tileW * (logo.naturalHeight / logo.naturalWidth))
    const stepX = Math.round(tileW * (1 + WM_GAP_RATIO))
    const stepY = Math.round(tileH * (1 + WM_GAP_RATIO))

    ctx.globalAlpha = WM_OPACITY
    // Rotate the whole context once, then tile across a region big enough to cover corners.
    ctx.save()
    ctx.rotate(WM_ANGLE)
    const diag = Math.ceil(Math.hypot(canvas.width, canvas.height))
    for (let y = -diag; y < diag; y += stepY) {
      for (let x = -diag; x < diag; x += stepX) {
        ctx.drawImage(logo, x, y, tileW, tileH)
      }
    }
    ctx.restore()
    ctx.globalAlpha = 1

    return canvas.toDataURL("image/jpeg", 0.92)
  } catch {
    return dataUrl
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("watermark: image load failed"))
    img.src = src
  })
}

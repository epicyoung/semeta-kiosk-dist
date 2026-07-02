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

const WM_TEXT = "SEMETA | SPINDONESIA"
const WM_ANGLE = -35 * (Math.PI / 180)
const WM_FONT_PX_RATIO = 0.028 // font size = 2.8% of image width
const WM_OPACITY = 0.4
const WM_STEP_X_RATIO = 0.42   // horizontal tile spacing = 42% of width
const WM_STEP_Y_RATIO = 0.22

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

    const fontPx = Math.max(14, Math.round(canvas.width * WM_FONT_PX_RATIO))
    ctx.font = `700 ${fontPx}px "DM Sans", system-ui, sans-serif`
    ctx.fillStyle = `rgba(255,255,255,${WM_OPACITY})`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"

    const stepX = Math.round(canvas.width * WM_STEP_X_RATIO)
    const stepY = Math.round(canvas.width * WM_STEP_Y_RATIO)
    // Rotate the whole context once, then tile across a region big enough to cover corners.
    ctx.save()
    ctx.rotate(WM_ANGLE)
    const diag = Math.ceil(Math.hypot(canvas.width, canvas.height))
    for (let y = -diag; y < diag; y += stepY) {
      for (let x = -diag; x < diag; x += stepX) {
        ctx.fillText(WM_TEXT, x, y)
      }
    }
    ctx.restore()

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

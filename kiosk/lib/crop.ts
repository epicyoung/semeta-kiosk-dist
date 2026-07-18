// Pure crop math for face-aware 2:3 template cropping. No I/O — unit-tested in crop.test.mjs.

export const HEADROOM_RATIO = 0.10

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi))

// Target window height for a given full width (width stays, height is trimmed).
// ratio = target aspect (w/h): 2/3 portrait (default), 3/2 landscape. h = w / ratio.
export function computeTargetHeight(width: number, ratio = 2 / 3): number {
  return Math.round(width / ratio)
}

// Vertical crop offset. faceY = top of topmost face bbox (ubun-ubun), or null (no face → center).
// Guarantees 0 <= result <= imageH - targetH so the crop never leaves the image bounds.
// Used when the image is TALLER than 2:3 (ratio < 2/3): trim top/bottom, full width kept.
export function computeCropTop(
  imageH: number,
  targetH: number,
  faceY: number | null,
  headroom: number,
): number {
  if (faceY == null) return clamp(Math.round((imageH - targetH) / 2), 0, imageH - targetH)
  return clamp(faceY - headroom, 0, imageH - targetH)
}

// Target window width for a given full height (height stays, width is trimmed).
// ratio = target aspect (w/h): 2/3 portrait (default), 3/2 landscape. w = h * ratio.
// Used when the image is WIDER than target: trim left/right, full height kept.
export function computeTargetWidth(height: number, ratio = 2 / 3): number {
  return Math.round(height * ratio)
}

// Horizontal crop offset. faceCenterX = center X of the face to keep centered, or null (→ center).
// Guarantees 0 <= result <= imageW - targetW so the crop never leaves the image bounds.
export function computeCropLeft(
  imageW: number,
  targetW: number,
  faceCenterX: number | null,
): number {
  if (faceCenterX == null) return clamp(Math.round((imageW - targetW) / 2), 0, imageW - targetW)
  return clamp(Math.round(faceCenterX - targetW / 2), 0, imageW - targetW)
}

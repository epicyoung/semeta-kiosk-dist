// Self-check for crop math. Run: node kiosk/lib/crop.test.mjs
// Mirror of pure logic in crop.ts (can't import .ts without build).
import assert from 'node:assert'

const HEADROOM_RATIO = 0.10
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi))
const computeTargetHeight = (w) => Math.round(w * 3 / 2)
const computeTargetWidth = (h) => Math.round(h * 2 / 3)
function computeCropTop(imageH, targetH, faceY, headroom) {
  if (faceY == null) return clamp(Math.round((imageH - targetH) / 2), 0, imageH - targetH)
  return clamp(faceY - headroom, 0, imageH - targetH)
}
function computeCropLeft(imageW, targetW, faceCenterX) {
  if (faceCenterX == null) return clamp(Math.round((imageW - targetW) / 2), 0, imageW - targetW)
  return clamp(Math.round(faceCenterX - targetW / 2), 0, imageW - targetW)
}

const W = 896
const targetH = computeTargetHeight(W)   // 1344
assert.equal(targetH, 1344)
const headroom = Math.round(targetH * HEADROOM_RATIO) // 134

// image 896x1400 (0.64), range [0, 56]; face y=200 → 200-134=66 → clamp 56
assert.equal(computeCropTop(1400, targetH, 200, headroom), 56)
// face high (y=100) → 100-134 = -34 → clamp 0
assert.equal(computeCropTop(1400, targetH, 100, headroom), 0)
// tall image 896x1600 (range [0,256]), face y=500 → 500-134=366 → clamp 256
assert.equal(computeCropTop(1600, 1344, 500, headroom), 256)
// tall image, face y=300 → 300-134=166, in [0,256] → 166 (headroom preserved)
assert.equal(computeCropTop(1600, 1344, 300, headroom), 166)
// no face → center: (1600-1344)/2 = 128
assert.equal(computeCropTop(1600, 1344, null, headroom), 128)

// ── Horizontal crop (image WIDER than 2:3, e.g. real 896x1280 Profesi photos) ──
// 896x1280 (ratio 0.700 > 0.667): keep height 1280, target width = round(1280*2/3) = 853
const HH = 1280
const targetW = computeTargetWidth(HH)   // 853
assert.equal(targetW, 853)
// crop range = [0, 896-853] = [0, 43]
// face centered (x=448) → left = 448 - 853/2 = 448-426.5 = 21.5 → round 22, in [0,43] → 22
assert.equal(computeCropLeft(896, targetW, 448), 22)
// face far left (x=100) → 100-426.5 = -326.5 → clamp 0
assert.equal(computeCropLeft(896, targetW, 100), 0)
// face far right (x=850) → 850-426.5 = 423.5 → clamp 43
assert.equal(computeCropLeft(896, targetW, 850), 43)
// no face → center: (896-853)/2 = 21.5 → round 22
assert.equal(computeCropLeft(896, targetW, null), 22)

console.log('ok')

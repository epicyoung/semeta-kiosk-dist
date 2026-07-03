// Resize math for R2 uploads — the money path. Canon 6000px MUST shrink to ≤1200 or
// every photo burns ~5MB bandwidth instead of ~200KB. node:assert, no framework.
import assert from "node:assert"
import { fitWithin } from "./upload.ts"

// Canon full-frame landscape 6000×4000 → longest edge clamped to 1200
assert.deepEqual(fitWithin(6000, 4000, 1200), { w: 1200, h: 800 })

// Portrait 4000×6000 → height is longest, clamp that
assert.deepEqual(fitWithin(4000, 6000, 1200), { w: 800, h: 1200 })

// Already small (AI ~786) → null = skip resize, upload as-is
assert.equal(fitWithin(786, 786, 1200), null)

// Exactly at limit → skip (≤, not <)
assert.equal(fitWithin(1200, 1200, 1200), null)

// One px over → resize kicks in
assert.notEqual(fitWithin(1201, 800, 1200), null)

console.log("fitWithin: all pass")

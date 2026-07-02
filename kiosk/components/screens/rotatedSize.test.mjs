// rotatedSize.test.mjs
import assert from 'node:assert'
const rotatedSize = (vw, vh, r) => (r === 90 || r === 270 ? { w: vh, h: vw } : { w: vw, h: vh })
assert.deepEqual(rotatedSize(1920, 1080, 0),   { w: 1920, h: 1080 })
assert.deepEqual(rotatedSize(1920, 1080, 90),  { w: 1080, h: 1920 }) // quarter-turn → tuker
assert.deepEqual(rotatedSize(1920, 1080, 180), { w: 1920, h: 1080 })
assert.deepEqual(rotatedSize(1920, 1080, 270), { w: 1080, h: 1920 })
console.log('ok')

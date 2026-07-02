// nextDenoiseStep.test.mjs — the one invariant that matters: never reveal a crisp
// image before the real result is ready. Mirrors nextDenoiseStep in ProcessingScreen.tsx.
import assert from 'node:assert'
const LAST_STEP = 4, HOLD_STEP = 3
const nextDenoiseStep = (s, ready) => (s >= LAST_STEP ? s : Math.min(s + 1, ready ? LAST_STEP : HOLD_STEP))

assert.equal(nextDenoiseStep(0, false), 1)          // climbs one rung while not ready
assert.equal(nextDenoiseStep(2, false), 3)
assert.equal(nextDenoiseStep(3, false), 3)          // parks at penultimate — never crisp early
assert.equal(nextDenoiseStep(3, true), 4)           // snaps to crisp only once ready
assert.equal(nextDenoiseStep(4, false), 4)          // terminal, no regress/overshoot
assert.equal(nextDenoiseStep(4, true), 4)

let s = 0
for (let i = 0; i < 9; i++) s = nextDenoiseStep(s, false) // full slow run
assert.equal(s, HOLD_STEP, 'slow gen parks at penultimate')
assert.equal(nextDenoiseStep(s, true), LAST_STEP, 'resolves to crisp only when ready')
console.log('ok')

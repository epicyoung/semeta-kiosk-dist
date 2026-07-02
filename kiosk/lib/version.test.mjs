// Self-check for computeHasUpdate. Run: node kiosk/lib/version.test.mjs
// Mirror of the pure logic in version.ts (can't import .ts without build).
import assert from 'node:assert'

function computeHasUpdate(current, latest) {
  if (!current || !latest) return false
  return current !== latest
}

// different hashes → update available
assert.equal(computeHasUpdate('408308c', 'abc1234'), true)
// same hash → no update
assert.equal(computeHasUpdate('408308c', '408308c'), false)
// offline (no latest) → never claim update
assert.equal(computeHasUpdate('408308c', null), false)
// not a git repo (no current) → no update
assert.equal(computeHasUpdate(null, 'abc1234'), false)
// both null → no update
assert.equal(computeHasUpdate(null, null), false)

console.log('ok')

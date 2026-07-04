// Clamp copies = deterrent double-print. Client bisa kirim angka gila (0, -5, 999,
// "abc", NaN) — printer jangan nurut. node:assert, no framework.
import assert from "node:assert"
import { clampCopies, MAX_COPIES } from "./print-copies.ts"

// Normal → apa adanya
assert.equal(clampCopies(1), 1)
assert.equal(clampCopies(3), 3)

// Bawah 1 → 1
assert.equal(clampCopies(0), 1)
assert.equal(clampCopies(-5), 1)

// Atas MAX → MAX
assert.equal(clampCopies(999), MAX_COPIES)
assert.equal(clampCopies(MAX_COPIES + 1), MAX_COPIES)

// Non-angka → 1 (aman, cetak sekali)
assert.equal(clampCopies("abc"), 1)
assert.equal(clampCopies(undefined), 1)
assert.equal(clampCopies(null), 1)
assert.equal(clampCopies(NaN), 1)

// Pecahan → trunc, bukan round
assert.equal(clampCopies(2.9), 2)

console.log("clampCopies: all pass")

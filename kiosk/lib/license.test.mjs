import assert from 'node:assert/strict'
import { reasonForStatus, withinGrace, offlineLicensedFresh, WM_CACHE_MAX_MS, RECONFIRM_WINDOW_MS } from './license.ts'

// reasonForStatus: HTTP verdict → lock reason
assert.equal(reasonForStatus(401), 'needs_activation') // no secret
assert.equal(reasonForStatus(404), 'needs_activation') // belum di-Top Up
assert.equal(reasonForStatus(402), 'expired')          // sesi habis
assert.equal(reasonForStatus(403), 'disabled')         // kiosk disabled / device mismatch

const now = 1_700_000_000_000

// withinGrace: null record = belum pernah aktivasi = NO grace
assert.equal(withinGrace(null, now), false)

// fresh (baru aja handshake) = in grace
assert.equal(withinGrace({ session_id: 's', remaining_sec: 100, lastOkAt: now }, now), true)

// 11 jam lalu = masih in grace (< 12h)
assert.equal(withinGrace({ session_id: 's', remaining_sec: 100, lastOkAt: now - 11 * 3600_000 }, now), true)

// tepat 12 jam = sudah lewat window (bukan < )
assert.equal(withinGrace({ session_id: 's', remaining_sec: 100, lastOkAt: now - RECONFIRM_WINDOW_MS }, now), false)

// 13 jam = lewat = NO grace = harus reconfirm
assert.equal(withinGrace({ session_id: 's', remaining_sec: 100, lastOkAt: now - 13 * 3600_000 }, now), false)

// offlineLicensedFresh: watermark-clean offline HANYA kalau cache masih fresh (< 1h DAN < sisa sewa)
assert.equal(offlineLicensedFresh(null, now), false) // belum pernah = watermark
// fresh, sisa sewa gede → bersih
assert.equal(offlineLicensedFresh({ session_id: 's', remaining_sec: 7200, lastOkAt: now - 60_000 }, now), true)
// cache > 1 jam → walau sewa masih banyak, terlalu basi = watermark
assert.equal(offlineLicensedFresh({ session_id: 's', remaining_sec: 999999, lastOkAt: now - WM_CACHE_MAX_MS - 1 }, now), false)
// cache < 1 jam TAPI sisa sewa udah lewat (sewa harusnya udah abis) = watermark
assert.equal(offlineLicensedFresh({ session_id: 's', remaining_sec: 30, lastOkAt: now - 60_000 }, now), false)

console.log('license.test.mjs: all passed')

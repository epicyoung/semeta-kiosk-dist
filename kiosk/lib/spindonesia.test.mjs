// Self-check for pickTemplates cache logic. Run: node kiosk/lib/spindonesia.test.mjs
import assert from 'node:assert'

function pickTemplates(fetched, cached) {
  if (fetched !== null) return fetched
  return cached ?? []
}

const A = [{ id: '1' }, { id: '2' }]
const B = [{ id: 'old' }]

// fetch sukses → pakai fetched
assert.deepEqual(pickTemplates(A, B), A)
// fetch gagal (null) + ada cache → pakai cache
assert.deepEqual(pickTemplates(null, B), B)
// fetch gagal + no cache → []
assert.deepEqual(pickTemplates(null, null), [])
// fetch sukses tapi kosong ([]) → [] (kosong valid, JANGAN fallback cache lama)
assert.deepEqual(pickTemplates([], B), [])

console.log('ok')

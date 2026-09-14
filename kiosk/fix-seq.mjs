// Perbaiki counter foto yang ke-reset (insiden 2026-09-12: rename folder event
// di tengah acara bikin seq balik ke 001 → QR tiap tamu nunjuk foto -001).
//
// Jalankan DI PC KIOSK:
//   node kiosk/fix-seq.mjs                       ← lihat semua counter hari ini (aman, ga ngubah)
//   node kiosk/fix-seq.mjs <folder-event>        ← set counter ke nomor foto tertinggi yg ada
//
// Contoh: node kiosk/fix-seq.mjs garudafood-20260912
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.TEMPLATE_LOCAL ?? 'C:/semeta'
const eventsDir = path.join(DATA_DIR, 'event')
const target = process.argv[2]

// Nomor tertinggi dari nama file yang bener-bener ada di disk = sumber kebenaran.
function highestSeq(dir) {
  let max = 0
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/-(\d{3})-full-(?:ori|ai)-semeta\.jpg$/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max
}

function readSeq(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'seq.json'), 'utf8')).seq
  } catch {
    return null
  }
}

if (!target) {
  const today = new Date()
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  console.log(`Folder event di ${eventsDir} (tanggal ${stamp}):\n`)
  for (const d of fs.readdirSync(eventsDir)) {
    if (!d.includes(stamp)) continue
    const dir = path.join(eventsDir, d)
    const counter = readSeq(dir)
    const disk = highestSeq(dir)
    const bad = counter !== null && counter < disk
    console.log(`  ${d}`)
    console.log(`    seq.json      : ${counter ?? '(tidak ada)'}`)
    console.log(`    foto tertinggi: ${disk}`)
    console.log(`    status        : ${bad ? '*** KE-RESET — perlu diperbaiki ***' : 'oke'}\n`)
  }
  console.log('Perbaiki dengan: node kiosk/fix-seq.mjs <nama-folder>')
  process.exit(0)
}

const dir = path.join(eventsDir, target)
if (!fs.existsSync(dir)) {
  console.error(`Folder ga ketemu: ${dir}`)
  process.exit(1)
}

const counter = readSeq(dir)
const disk = highestSeq(dir)

if (disk === 0) {
  console.error('Ga ada file foto di folder ini — ga bisa nentuin nomor. Batal.')
  process.exit(1)
}
if (counter !== null && counter >= disk) {
  console.log(`Counter udah bener (seq=${counter} >= foto tertinggi ${disk}). Ga ada yang diubah.`)
  process.exit(0)
}

const seqFile = path.join(dir, 'seq.json')
if (fs.existsSync(seqFile)) {
  fs.copyFileSync(seqFile, `${seqFile}.bak-${Date.now()}`)
}
fs.writeFileSync(seqFile, JSON.stringify({ seq: disk }, null, 2))
console.log(`seq.json: ${counter ?? '(tidak ada)'} -> ${disk}`)
console.log(`Foto berikutnya jadi ${String(disk + 1).padStart(3, '0')}. Ga ada file yang ketimpa lagi.`)

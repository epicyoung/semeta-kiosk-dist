#!/usr/bin/env node
/**
 * Semeta Template Manager
 *
 * USAGE:
 *   node manage-templates.js                              → list semua template di PB
 *   node manage-templates.js sync                         → sync folder → PocketBase
 *   node manage-templates.js set-cat "Semeta" id1 id2    → set category by ID
 *   node manage-templates.js set-cat "Bali" --all        → set category semua
 *   node manage-templates.js set-cat "Bali" --cat "Old"  → set semua dari category tertentu
 *   node manage-templates.js rename <id> "Nama Baru"     → rename
 *   node manage-templates.js delete id1 id2              → hapus by ID
 *   node manage-templates.js delete --cat "Wedding"      → hapus semua category tertentu
 *   node manage-templates.js toggle id1 id2              → toggle is_active
 *
 * SYNC — folder = source of truth:
 *   put-template-here/
 *   ├── Wedding/           → category "Wedding"
 *   │   ├── pria.jpg
 *   │   └── wanita.jpg
 *   └── Superhero/         → category "Superhero"
 *       ├── spiderman.jpg
 *       └── batman.jpg
 *
 *   Hapus folder Wedding/ → node manage-templates.js sync → Wedding hilang dari PB
 *   Hapus batman.jpg      → node manage-templates.js sync → batman hilang dari PB
 *   Tambah file baru      → node manage-templates.js sync → file baru masuk PB
 */

const fs   = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

const PB_URL      = 'http://127.0.0.1:8090'
const PB_EMAIL    = 'spindonesia360@gmail.com'
const PB_PASSWORD = 'spindonesia'
const INBOX       = path.join(__dirname, 'put-template-here')

// ── helpers ──────────────────────────────────────────────────────────────────

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.request(url, opts, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: data }) }
      })
    })
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

async function login() {
  const res = await fetchJson(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  })
  if (!res.body?.token) throw new Error('Login gagal: ' + JSON.stringify(res.body))
  return res.body.token
}

async function listAll(token) {
  const res = await fetchJson(`${PB_URL}/api/collections/templates/records?perPage=500&sort=category,name`, {
    headers: { Authorization: token },
  })
  return res.body?.items ?? []
}

async function patchRecord(token, id, patch) {
  return fetchJson(`${PB_URL}/api/collections/templates/records/${id}`, {
    method: 'PATCH',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

async function deleteRecord(token, id) {
  return fetchJson(`${PB_URL}/api/collections/templates/records/${id}`, {
    method: 'DELETE',
    headers: { Authorization: token },
  })
}

// ── image helpers (sama kayak bulk_import.js) ────────────────────────────────

function toTitleCase(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function getImageDimensions(fp) {
  const buf = fs.readFileSync(fp)
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2
    while (i < buf.length - 8) {
      if (buf[i] !== 0xFF) break
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xC0 && marker <= 0xC3)
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }
      i += 2 + len
    }
  }
  return null
}

function isValidRatio(w, h) {
  return Math.abs((w / h) - (2 / 3)) / (2 / 3) < 0.01
}

function buildMultipart(fields, fileField, filePath, boundary) {
  const parts = []
  for (const [key, val] of Object.entries(fields))
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}`)
  const ext = path.extname(filePath).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
  const fileData = fs.readFileSync(filePath)
  const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${path.basename(filePath)}"\r\nContent-Type: ${mime}\r\n\r\n`)
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
  return Buffer.concat([Buffer.from(parts.join('\r\n') + '\r\n'), header, fileData, footer])
}

async function uploadTemplate(token, filePath, name, category) {
  const boundary = '----SemetaBoundary' + Date.now()
  const body = buildMultipart(
    { name, category, engine_type: 'faceswap', gender_filter: 'ALL', token_cost: '1', is_active: 'true' },
    'thumbnail', filePath, boundary
  )
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${PB_URL}/api/collections/templates/records`)
    const req = http.request({
      hostname: urlObj.hostname, port: urlObj.port || 80, path: urlObj.pathname, method: 'POST',
      headers: { Authorization: token, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// Scan folder → { name, category, fp }[]
function scanFolder() {
  if (!fs.existsSync(INBOX)) return []
  const exts = ['.jpg', '.jpeg', '.png']
  const result = []
  for (const entry of fs.readdirSync(INBOX, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const subdir = path.join(INBOX, entry.name)
      for (const file of fs.readdirSync(subdir).filter(f => exts.includes(path.extname(f).toLowerCase())))
        result.push({ name: toTitleCase(file), category: entry.name, fp: path.join(subdir, file) })
    } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
      result.push({ name: toTitleCase(entry.name), category: 'Semeta', fp: path.join(INBOX, entry.name) })
    }
  }
  return result
}

function pad(str, len) { return String(str ?? '').padEnd(len).slice(0, len) }

// ── commands ─────────────────────────────────────────────────────────────────

async function cmdList(token) {
  const templates = await listAll(token)
  console.log(`\n📋 Total: ${templates.length} template\n`)
  if (!templates.length) { console.log('  (kosong)'); return }
  console.log(`  ${'ID'.padEnd(16)} ${'Name'.padEnd(24)} ${'Category'.padEnd(16)} Active`)
  console.log('  ' + '─'.repeat(64))
  for (const t of templates)
    console.log(`  ${pad(t.id,16)} ${pad(t.name,24)} ${pad(t.category,16)} ${t.is_active ? '✓' : '✗'}`)
  console.log()
}

async function cmdSync(token) {
  console.log('\n🔄 Sync: put-template-here/ → PocketBase\n')

  const folderFiles = scanFolder()
  const pbTemplates = await listAll(token)

  // Key = "category||name" (case-sensitive)
  const folderKeys = new Set(folderFiles.map(f => `${f.category}||${f.name}`))
  const pbByKey    = Object.fromEntries(pbTemplates.map(t => [`${t.category}||${t.name}`, t]))

  const toAdd    = folderFiles.filter(f => !pbByKey[`${f.category}||${f.name}`])
  const toDelete = pbTemplates.filter(t => !folderKeys.has(`${t.category}||${t.name}`))

  // Validasi rasio untuk yang akan di-add
  const valid = [], skipped = []
  for (const f of toAdd) {
    const dims = getImageDimensions(f.fp)
    if (!dims) { skipped.push({ ...f, reason: 'Tidak bisa baca dimensi' }); continue }
    if (!isValidRatio(dims.w, dims.h)) { skipped.push({ ...f, reason: `Rasio salah ${dims.w}×${dims.h} (butuh 2:3)` }); continue }
    valid.push(f)
  }

  console.log(`  📂 Folder : ${folderFiles.length} file`)
  console.log(`  🗄️  PB     : ${pbTemplates.length} template`)
  console.log(`  ➕ Tambah  : ${valid.length}`)
  console.log(`  🗑️  Hapus   : ${toDelete.length}`)
  if (skipped.length) console.log(`  ⚠️  Skip   : ${skipped.length} (rasio salah)`)
  console.log()

  if (valid.length === 0 && toDelete.length === 0) {
    console.log('✅ Sudah sinkron, tidak ada perubahan.\n')
    return
  }

  let ok = 0, fail = 0

  for (const f of valid) {
    process.stdout.write(`  ➕ [${f.category}] ${f.name}... `)
    try {
      const res = await uploadTemplate(token, f.fp, f.name, f.category)
      if (res.status === 200 || res.status === 201) { console.log('✓'); ok++ }
      else { console.log(`✗ (${res.status})`); fail++ }
    } catch (e) { console.log('✗ ' + e.message); fail++ }
  }

  for (const t of toDelete) {
    process.stdout.write(`  🗑️  [${t.category}] ${t.name}... `)
    const res = await deleteRecord(token, t.id)
    if (res.status === 204 || res.status === 200) { console.log('✓ dihapus'); ok++ }
    else { console.log(`✗ (${res.status})`); fail++ }
  }

  if (skipped.length) {
    console.log('\n  ⚠️  Di-skip (rasio bukan 2:3):')
    skipped.forEach(s => console.log(`     ✗ [${s.category}] ${s.name} — ${s.reason}`))
  }

  console.log(`\n📊 ${ok} perubahan, ${fail} gagal\n`)
}

async function cmdSetCat(token, args) {
  const newCat = args[0]
  if (!newCat) { console.error('❌ Usage: set-cat "CategoryBaru" [id1 id2 | --all | --cat "Lama"]'); process.exit(1) }
  const rest = args.slice(1)
  let targets = []

  if (rest.includes('--all')) {
    targets = (await listAll(token)).map(t => ({ id: t.id, name: t.name }))
  } else if (rest.includes('--cat')) {
    const filterCat = rest[rest.indexOf('--cat') + 1]
    targets = (await listAll(token)).filter(t => t.category === filterCat).map(t => ({ id: t.id, name: t.name }))
    console.log(`\n🔍 Filter "${filterCat}" → ${targets.length} template`)
  } else {
    targets = rest.filter(s => !s.startsWith('--')).map(id => ({ id, name: id }))
  }

  if (!targets.length) { console.log('\n⚠️  Tidak ada template yang cocok.\n'); return }
  console.log(`\n✏️  Set category → "${newCat}" (${targets.length} template)\n`)
  let ok = 0, fail = 0
  for (const t of targets) {
    process.stdout.write(`  ${pad(t.id,16)} ${pad(t.name,22)}... `)
    const res = await patchRecord(token, t.id, { category: newCat })
    if (res.status === 200) { console.log('✓'); ok++ } else { console.log(`✗ (${res.status})`); fail++ }
  }
  console.log(`\n📊 ${ok} berhasil, ${fail} gagal\n`)
}

async function cmdRename(token, args) {
  const [id, newName] = args
  if (!id || !newName) { console.error('❌ Usage: rename <id> "Nama Baru"'); process.exit(1) }
  const res = await patchRecord(token, id, { name: newName })
  console.log(res.status === 200 ? `\n✓ ${id} → "${newName}"\n` : `\n✗ Gagal (${res.status})\n`)
}

async function cmdDelete(token, args) {
  if (!args.length) { console.error('❌ Usage: delete id1 id2 ... | delete --cat "Wedding" | delete --all'); process.exit(1) }

  let targets = []
  if (args.includes('--all')) {
    targets = (await listAll(token)).map(t => ({ id: t.id, name: t.name }))
    console.log(`\n🔍 --all → ${targets.length} template akan dihapus`)
  } else if (args.includes('--cat')) {
    const cat = args[args.indexOf('--cat') + 1]
    if (!cat) { console.error('❌ --cat butuh nama category'); process.exit(1) }
    targets = (await listAll(token)).filter(t => t.category === cat).map(t => ({ id: t.id, name: t.name }))
    console.log(`\n🔍 Category "${cat}" → ${targets.length} template akan dihapus`)
  } else {
    targets = args.map(id => ({ id, name: id }))
  }

  if (!targets.length) { console.log('\n⚠️  Tidak ada yang dihapus.\n'); return }
  console.log(`\n🗑️  Hapus ${targets.length} template...\n`)
  let ok = 0, fail = 0
  for (const t of targets) {
    process.stdout.write(`  ${pad(t.id,16)} ${pad(t.name,22)}... `)
    const res = await deleteRecord(token, t.id)
    if (res.status === 204 || res.status === 200) { console.log('✓ dihapus'); ok++ }
    else { console.log(`✗ (${res.status})`); fail++ }
  }
  console.log(`\n📊 ${ok} dihapus, ${fail} gagal\n`)
}

async function cmdToggle(token, args) {
  if (!args.length) { console.error('❌ Usage: toggle id1 id2 ...'); process.exit(1) }
  const all = await listAll(token)
  const byId = Object.fromEntries(all.map(t => [t.id, t]))
  console.log()
  for (const id of args) {
    const t = byId[id]
    if (!t) { console.log(`  ${id} ✗ tidak ditemukan`); continue }
    const res = await patchRecord(token, id, { is_active: !t.is_active })
    if (res.status === 200)
      console.log(`  ${pad(id,16)} ${pad(t.name,22)} → ${!t.is_active ? '✓ aktif' : '✗ nonaktif'}`)
    else console.log(`  ${id} ✗ gagal`)
  }
  console.log()
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════╗')
  console.log('║     Semeta Template Manager v2.0        ║')
  console.log('╚══════════════════════════════════════════╝')

  const [,, cmd, ...args] = process.argv
  const token = await login()

  switch (cmd ?? 'list') {
    case 'list':    return cmdList(token)
    case 'sync':    return cmdSync(token)
    case 'set-cat': return cmdSetCat(token, args)
    case 'rename':  return cmdRename(token, args)
    case 'delete':  return cmdDelete(token, args)
    case 'toggle':  return cmdToggle(token, args)
    default:
      console.log(`
USAGE:
  node manage-templates.js                         → list semua
  node manage-templates.js sync                    → sync folder → PB
  node manage-templates.js set-cat "Cat" id1 id2   → set category by ID
  node manage-templates.js set-cat "Cat" --all     → set semua
  node manage-templates.js set-cat "Cat" --cat "X" → set dari category X
  node manage-templates.js rename <id> "Nama"      → rename
  node manage-templates.js delete id1 id2          → hapus by ID
  node manage-templates.js delete --cat "Wedding"  → hapus 1 category
  node manage-templates.js toggle id1 id2          → toggle aktif
`)
  }
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1) })

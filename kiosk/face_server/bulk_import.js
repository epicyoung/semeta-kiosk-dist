#!/usr/bin/env node
/**
 * Semeta Bulk Template Importer
 * Baca semua .jpg/.jpeg/.png dari ./put-template-here/
 * Validasi rasio 2:3, upload ke PocketBase lokal.
 *
 * Run: node bulk_import.js
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const PB_URL = 'http://127.0.0.1:8090'
const PB_EMAIL = 'admin@admin.com'
const PB_PASSWORD = 'admin'
const INBOX = path.join(__dirname, 'put-template-here')

// ── helpers ──────────────────────────────────────────────────────────────────

function toTitleCase(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.request(url, { ...opts }, res => {
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
  if (!res.body.token) throw new Error('Login gagal: ' + JSON.stringify(res.body))
  return res.body.token
}

function getImageDimensions(filepath) {
  const buf = fs.readFileSync(filepath)

  // PNG: bytes 16-24
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    const w = buf.readUInt32BE(16)
    const h = buf.readUInt32BE(20)
    return { w, h }
  }

  // JPEG: scan SOF markers
  let i = 0
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    i = 2
    while (i < buf.length - 8) {
      if (buf[i] !== 0xFF) break
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xC0 && marker <= 0xC3) {
        const h = buf.readUInt16BE(i + 5)
        const w = buf.readUInt16BE(i + 7)
        return { w, h }
      }
      i += 2 + len
    }
  }

  return null
}

function isValidRatio(w, h) {
  // 2:3 = width * 3 === height * 2, allow ±1% tolerance
  const ratio = w / h
  const target = 2 / 3
  return Math.abs(ratio - target) / target < 0.01
}

function buildMultipart(fields, fileField, filePath, boundary) {
  const parts = []

  for (const [key, val] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}`
    )
  }

  const filename = path.basename(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
  const fileData = fs.readFileSync(filePath)

  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
  )
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`)

  return Buffer.concat([
    Buffer.from(parts.join('\r\n') + '\r\n'),
    header,
    fileData,
    footer,
  ])
}

async function uploadTemplate(token, filePath, name, category) {
  const boundary = '----SemetaBoundary' + Date.now()
  const body = buildMultipart(
    {
      name,
      category: category || 'Semeta',
      engine_type: 'faceswap',
      gender_filter: 'ALL',
      token_cost: '1',
      is_active: 'true',
    },
    'thumbnail',
    filePath,
    boundary
  )

  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${PB_URL}/api/collections/templates/records`)
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Authorization': token,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
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

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════╗')
  console.log('║   Semeta Bulk Template Importer v2.0    ║')
  console.log('╚══════════════════════════════════════════╝\n')
  console.log('  Struktur folder:')
  console.log('  put-template-here/')
  console.log('  ├── Wedding/        ← category "Wedding"')
  console.log('  │   ├── foto1.jpg')
  console.log('  │   └── foto2.jpg')
  console.log('  └── foto-root.jpg   ← category "Semeta" (default)\n')

  if (!fs.existsSync(INBOX)) {
    console.error('❌ Folder put-template-here tidak ditemukan:', INBOX)
    process.exit(1)
  }

  const exts = ['.jpg', '.jpeg', '.png']

  // Kumpulin semua file: { fp, file, category }
  const allFiles = []

  const entries = fs.readdirSync(INBOX, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // subfolder = category
      const category = entry.name
      const subdir = path.join(INBOX, entry.name)
      const subfiles = fs.readdirSync(subdir).filter(f => exts.includes(path.extname(f).toLowerCase()))
      for (const file of subfiles) {
        allFiles.push({ fp: path.join(subdir, file), file, category })
      }
    } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
      // file di root = category default
      allFiles.push({ fp: path.join(INBOX, entry.name), file: entry.name, category: 'Semeta' })
    }
  }

  if (allFiles.length === 0) {
    console.log('⚠️  Tidak ada gambar ditemukan.')
    process.exit(0)
  }

  // Validasi rasio
  const valid = []
  const skipped = []

  for (const item of allFiles) {
    const dims = getImageDimensions(item.fp)
    if (!dims) { skipped.push({ ...item, reason: 'Tidak bisa baca dimensi' }); continue }
    if (!isValidRatio(dims.w, dims.h)) {
      skipped.push({ ...item, reason: `Rasio salah ${dims.w}×${dims.h} (butuh 2:3)` })
    } else {
      valid.push(item)
    }
  }

  // Summary per category
  const cats = [...new Set(valid.map(v => v.category))]
  console.log(`📁 Ditemukan ${valid.length} file valid di ${cats.length} category:\n`)
  for (const cat of cats) {
    const count = valid.filter(v => v.category === cat).length
    console.log(`   📂 ${cat} (${count} file)`)
  }
  console.log()

  if (skipped.length > 0) {
    console.log('⚠️  Di-skip:')
    skipped.forEach(s => console.log(`   ✗ [${s.category}] ${s.file} — ${s.reason}`))
    console.log()
  }

  if (valid.length === 0) {
    console.log('❌ Tidak ada file valid untuk di-upload.')
    process.exit(0)
  }

  let token
  try {
    token = await login()
    console.log('🔐 Login PocketBase berhasil\n')
  } catch (e) {
    console.error('❌ Login gagal:', e.message)
    process.exit(1)
  }

  let ok = 0, fail = 0

  for (const { fp, file, category } of valid) {
    const name = toTitleCase(file)
    process.stdout.write(`   [${category}] ↑ ${name}... `)
    try {
      const res = await uploadTemplate(token, fp, name, category)
      if (res.status === 200 || res.status === 201) {
        console.log('✓')
        ok++
      } else {
        console.log(`✗ (${res.status}: ${JSON.stringify(res.body).slice(0, 80)})`)
        fail++
      }
    } catch (e) {
      console.log('✗ Error:', e.message)
      fail++
    }
  }

  console.log('\n══════════════════════════════════════════')
  console.log(`📊 Hasil: ${ok} berhasil, ${fail} gagal, ${skipped.length} di-skip`)
  console.log('══════════════════════════════════════════\n')
}

main().catch(e => { console.error(e); process.exit(1) })

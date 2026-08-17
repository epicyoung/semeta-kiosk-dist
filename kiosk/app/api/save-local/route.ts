import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { eventFolder, eventDirPath, originalFilename, aiFilename } from '@/lib/event'

/** Header sniff, bukan cek panjang: sampah 56 byte dari `Buffer.from(url,'base64')` lolos
 *  kalau yang dicek cuma "ada isinya". JPEG=FFD8FF, PNG=89504E47. Pure — dites di
 *  __tests__/save-local.test.ts. */
export function isImageBytes(b: Uint8Array): boolean {
  const isJpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  const isPng = b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  return isJpeg || isPng
}

/**
 * POST { event_name, seq, kind: 'original'|'ai', image_base64 }
 * Writes the full-res photo to C:/semeta/event/<folder>/<conventional-name>. Local print only.
 * `image_base64` boleh data URL, base64 mentah, ATAU url http R2 (nama field-nya warisan).
 */
export async function POST(req: NextRequest) {
  const { event_name, seq, kind, image_base64 } = await req.json()
  if (typeof event_name !== 'string' || typeof seq !== 'string' || typeof image_base64 !== 'string') {
    return NextResponse.json({ error: 'event_name, seq, image_base64 required' }, { status: 400 })
  }
  if (kind !== 'original' && kind !== 'ai') return NextResponse.json({ error: 'kind must be original or ai' }, { status: 400 })
  // seq masuk mentah ke filename → path.join bakal resolve ../ ; digits-only matiin traversal
  if (!/^\d{1,4}$/.test(seq)) return NextResponse.json({ error: 'seq must be 1-4 digits' }, { status: 400 })

  const filename = kind === 'ai'
    ? aiFilename(event_name, seq)
    : originalFilename(event_name, seq)
  const dir = eventDirPath(eventFolder(event_name))
  fs.mkdirSync(dir, { recursive: true })

  // Tiga bentuk masuk ke sini: data URL (faceswap lokal), base64 mentah, DAN url http R2
  // (jalur engine 'api' — callGoogleImage upload ke R2 dulu, yang balik URL bukan bytes).
  // Yang ketiga dulu jatuh ke Buffer.from(url,'base64'): Node GA ngelempar, dia diem-diem
  // buang karakter non-base64 lalu nulis ~56 byte sampah ber-ekstensi .jpg. Foto keliatan
  // bener di preview, rusaknya baru ketauan pas folder event dibuka — sesudah event kelar.
  let bytes: Buffer
  if (/^https?:\/\//i.test(image_base64)) {
    const r = await fetch(image_base64)
    if (!r.ok) {
      return NextResponse.json({ error: `fetch gagal ${r.status}` }, { status: 502 })
    }
    bytes = Buffer.from(await r.arrayBuffer())
  } else {
    const b64 = image_base64.includes(',') ? image_base64.split(',')[1] : image_base64
    bytes = Buffer.from(b64, 'base64')
  }

  // Fail loud: mending 422 + file GA dibikin daripada .jpg korup yang lolos sampai hari-H.
  if (!isImageBytes(bytes)) {
    console.error('[save-local] bukan gambar', { kind, seq, bytes: bytes.length })
    return NextResponse.json({ error: 'bukan JPEG/PNG yang sah' }, { status: 422 })
  }

  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, bytes)

  return NextResponse.json({ path: filePath, filename })
}

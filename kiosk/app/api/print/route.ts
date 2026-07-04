import { NextRequest, NextResponse } from 'next/server'
import { print } from 'pdf-to-printer'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { clampCopies } from '@/lib/print-copies'

// Native silent print via SumatraPDF (bundled with pdf-to-printer). No browser
// print engine = no Chrome print-preview flash on the kiosk. Foto sudah 2:3 (4×6),
// scale:'fit' pas ke kertas 4R. Default printer (no `printer` opt) → -print-to-default.
export const runtime = 'nodejs'

/** Ambil bytes foto: data: URL langsung decode, http(s) di-fetch. */
async function loadImageBytes(url: string): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const b64 = url.split(',')[1] ?? ''
    return Buffer.from(b64, 'base64')
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch foto gagal: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * POST { url: string (data: atau http), copies?: number }
 * Print silent ke default Windows printer. Localhost-only (kiosk lokal).
 */
export async function POST(req: NextRequest) {
  const { url, copies } = await req.json().catch(() => ({}))
  if (typeof url !== 'string' || url.length === 0) {
    return NextResponse.json({ error: 'url required' }, { status: 400 })
  }

  const nCopies = clampCopies(copies)

  const tmp = path.join(os.tmpdir(), `semeta-print-${process.hrtime.bigint()}.jpg`)
  try {
    fs.writeFileSync(tmp, await loadImageBytes(url))
    // SumatraPDF native support JPG; scale:'fit' fit-to-page 4×6, silent by default.
    await print(tmp, { scale: 'fit', copies: nCopies })
    return NextResponse.json({ ok: true, copies: nCopies })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'print gagal'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

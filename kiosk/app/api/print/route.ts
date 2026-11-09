import { NextResponse } from 'next/server'
import { print, getPrinters } from 'pdf-to-printer'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertLocalMutation } from '@/lib/local-request'

export const runtime = 'nodejs'

// Print ke queue Windows spesifik. Paper size + "2inch Cut" DNP itu vendor-specific
// (DEVMODE dmDriverExtra) — ga bisa disetel dari browser. Solusinya: dua queue Windows
// nunjuk port USB yang sama, masing-masing di-preset permanen di Printer Preferences:
//   RX1-STRIP → paper 2x6, 2inch Cut: Enable
//   RX1-4R    → paper 4x6
// Aplikasi tinggal milih nama string. Nol DEVMODE hacking.
//
// Nama queue kini env-overridable (PRINTER_STRIP / PRINTER_4R). Default FALLBACK tetap
// RX1-STRIP / RX1-4R persis kayak dulu, jadi kalau env kosong di venue sistem jalan 100%
// tanpa ubah setup. Override cuma buat kiosk yang printernya beda nama.
const PRINTERS: Record<string, string> = {
  strip2: process.env.PRINTER_STRIP ?? 'RX1-STRIP',
  print4r: process.env.PRINTER_4R ?? 'RX1-4R',
}

export async function POST(req: Request) {
  try { assertLocalMutation(req) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Ditolak' }, { status: 403 }) }
  let body: { mode?: string; image?: string; copies?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  // Whitelist: string dari browser jadi argumen execFile. Jangan pernah dilewat.
  const printer = PRINTERS[String(body.mode)]
  if (!printer) return NextResponse.json({ error: 'bad mode' }, { status: 400 })
  if (!body.image?.startsWith('data:image/')) {
    return NextResponse.json({ error: 'bad image' }, { status: 400 })
  }
  // Cap payload: tanpa ini caller bisa dorong base64 raksasa ke spooler/temp disk.
  if (body.image.length > 60_000_000) {
    return NextResponse.json({ error: 'image too large' }, { status: 413 })
  }

  // Queue belum ke-install → 404 supaya caller jatuh ke window.print(). Tanpa cek ini
  // SumatraPDF exit 0 tanpa nyetak apa-apa: "print ga keluar", gejala paling mahal di lapangan.
  const known = await getPrinters().catch(() => [])
  if (!known.some(p => p.name === printer)) {
    return NextResponse.json({ error: `queue "${printer}" not installed` }, { status: 404 })
  }

  const copies = Math.min(20, Math.max(1, Math.trunc(body.copies ?? 1) || 1))
  const file = join(tmpdir(), `booth-${Date.now()}.jpg`)
  await writeFile(file, Buffer.from(body.image.split(',')[1] ?? '', 'base64'))
  try {
    // SumatraPDF (di-bundle pdf-to-printer) telan JPEG langsung — ga perlu dibungkus PDF.
    await print(file, { printer, copies })
  } finally {
    // Buang temp setelah spooler selesai; booth bisa jalan berhari-hari.
    const { unlink } = await import('node:fs/promises')
    await unlink(file).catch(() => {})
  }
  return NextResponse.json({ ok: true })
}

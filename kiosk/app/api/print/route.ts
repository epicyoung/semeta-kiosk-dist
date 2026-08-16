import { NextResponse } from 'next/server'
import { print, getPrinters } from 'pdf-to-printer'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const runtime = 'nodejs'

// Print ke queue Windows spesifik. Paper size + "2inch Cut" DNP itu vendor-specific
// (DEVMODE dmDriverExtra) — ga bisa disetel dari browser. Solusinya: dua queue Windows
// nunjuk port USB yang sama, masing-masing di-preset permanen di Printer Preferences:
//   RX1-STRIP → paper 2x6, 2inch Cut: Enable
//   RX1-4R    → paper 4x6
// Aplikasi tinggal milih nama string. Nol DEVMODE hacking.
//
// ponytail: nama queue hardcoded — pindah ke semeta.config.json kalau ada kiosk
// yang printernya beda nama.
const PRINTERS: Record<string, string> = { strip2: 'RX1-STRIP', print4r: 'RX1-4R' }

export async function POST(req: Request) {
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

  // Queue belum ke-install → 404 supaya caller jatuh ke window.print(). Tanpa cek ini
  // SumatraPDF exit 0 tanpa nyetak apa-apa: "print ga keluar", gejala paling mahal di lapangan.
  const known = await getPrinters().catch(() => [])
  if (!known.some(p => p.name === printer)) {
    return NextResponse.json({ error: `queue "${printer}" not installed` }, { status: 404 })
  }

  const copies = Math.min(20, Math.max(1, Math.trunc(body.copies ?? 1) || 1))
  const file = join(tmpdir(), `booth-${Date.now()}.jpg`)
  await writeFile(file, Buffer.from(body.image.split(',')[1] ?? '', 'base64'))
  // SumatraPDF (di-bundle pdf-to-printer) telan JPEG langsung — ga perlu dibungkus PDF.
  await print(file, { printer, copies })
  // ponytail: temp file dibiarin, Windows sapu %TEMP% sendiri. Tambah unlink kalau
  // booth jalan berminggu-minggu tanpa restart.
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { eventFolder, eventDirPath } from '@/lib/event'
import { isSafeGalleryFile } from '@/lib/gallery'

/**
 * GET /api/gallery/image?event_name=Fun+Run&file=fun-run-20260914-001-print-semeta.jpg
 * Serve satu file gambar dari folder event — buat thumbnail & preview di GalleryScreen.
 *
 * Dikurung ke folder event yang aktif: `file` cuma boleh basename (tanpa separator,
 * tanpa ..), dan path hasilnya diverifikasi masih di dalam folder event. Tanpa dua
 * lapis itu, ?file=../../../windows/system32/... bakal kebaca.
 */
export async function GET(req: NextRequest) {
  const eventName = req.nextUrl.searchParams.get('event_name')
  const file = req.nextUrl.searchParams.get('file')

  if (!eventName) {
    return NextResponse.json({ error: 'event_name required' }, { status: 400 })
  }
  // Guard-nya pure + dites di __tests__/gallery.test.ts — yang dites = yang jalan.
  if (!isSafeGalleryFile(file)) {
    return NextResponse.json({ error: 'invalid file' }, { status: 400 })
  }

  const dir = eventDirPath(eventFolder(eventName))
  const filePath = path.join(dir, file)

  // Sabuk kedua: pastiin hasil join beneran masih di dalam folder event.
  const rel = path.relative(path.resolve(dir), path.resolve(filePath))
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 })
  }

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const buf = fs.readFileSync(filePath)
  const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg'
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': mime,
      // File lokal, isinya ga berubah setelah ditulis — aman di-cache browser.
      'Cache-Control': 'private, max-age=3600',
    },
  })
}

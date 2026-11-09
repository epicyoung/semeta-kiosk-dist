import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import { eventFolder } from '@/lib/event'
import { getGalleryStore } from '@/lib/gallery-store'
import { assertLocalRead } from '@/lib/local-request'

export const runtime = 'nodejs'
export async function GET(req: NextRequest) {
  try {
    assertLocalRead(req)
    const query = req.nextUrl.searchParams
    const eventId = query.get('event_id') || (query.get('event_name') ? eventFolder(query.get('event_name')!) : '')
    const file = query.get('file') ?? ''
    const resolved = getGalleryStore().resolveFile(eventId, file)
    if (!fs.existsSync(resolved)) return NextResponse.json({ error: 'File tidak tersedia' }, { status: 404 })
    return new NextResponse(fs.readFileSync(resolved), { headers: { 'Content-Type': /\.png$/i.test(file) ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } })
  } catch {
    return NextResponse.json({ error: 'File tidak valid' }, { status: 400 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { eventFolder } from '@/lib/event'
import { getGalleryStore } from '@/lib/gallery-store'
import { shareUrlFor, type GalleryVariant } from '@/lib/gallery'
import { assertLocalMutation, assertLocalRead } from '@/lib/local-request'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    assertLocalRead(req)
    const query = req.nextUrl.searchParams
    const store = getGalleryStore()
    if (query.get('events') === '1') return NextResponse.json({ events: store.events() })
    const id = query.get('event_id') || (query.get('event_name') ? eventFolder(query.get('event_name')!) : '')
    return NextResponse.json(store.list(id, { cursor: query.get('cursor') ?? undefined, seq: query.get('seq') ?? undefined, limit: Number(query.get('limit') || 48) }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[gallery] read failed', error)
    return NextResponse.json({ error: 'Gagal membaca galeri' }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
  try { assertLocalMutation(req) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Ditolak' }, { status: 403 }) }
    const body = await req.json()
    if (typeof body.event_name !== 'string' || !body.event_name.trim()) throw new Error('Nama event diperlukan')
    // session_id eksplisit (Fast Mode) atau diturunkan dari event_name + seq (flow kamera lama).
    const sessionId = typeof body.session_id === 'string' ? body.session_id : `${eventFolder(body.event_name)}-${body.seq}`
    const store = getGalleryStore()
    let entry
    if (typeof body.image_base64 === 'string') {
      const recipes = ['single_4r', 'single_strip', 'sheet_2up', 'iso_page']
      const sizes = ['4R_PORTRAIT', '4R_LANDSCAPE', '2R_STRIP', 'A4_PORTRAIT', 'A4_LANDSCAPE', 'A3_PORTRAIT', 'A3_LANDSCAPE']
      if (body.print_size && !sizes.includes(body.print_size)) throw new Error('Ukuran cetak tidak valid')
      if (body.recipe && !recipes.includes(body.recipe)) throw new Error('Layout tidak valid')
      const decode = (value: string) => Buffer.from(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value, 'base64')
      const image = decode(body.image_base64)
      if (image.length > 50 * 1024 * 1024) throw new Error('Foto terlalu besar')
      entry = await store.saveVariant({ sessionId, eventName: body.event_name, image,
        sheet: typeof body.sheet_base64 === 'string' ? decode(body.sheet_base64) : undefined,
        recipe: (body.recipe ?? 'single_4r') as GalleryVariant['recipe'], printSize: body.print_size, label: body.label })
    }
    const url = typeof body.share_url === 'string' ? body.share_url : typeof body.r2_key_b === 'string' ? shareUrlFor(body.r2_key_b, body.m, body.a) : null
    if (url) entry = await store.saveShare({ sessionId, eventName: body.event_name, shareUrl: url, key: body.r2_key_b, m: body.m, a: body.a })
    if (!entry) throw new Error('Foto atau URL QR diperlukan')
    return NextResponse.json({ ok: true, entry })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Gagal menyimpan galeri' }, { status: 400 })
  }
}

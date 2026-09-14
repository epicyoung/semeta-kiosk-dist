import { NextResponse } from 'next/server'
import { dcc, validateDccExe } from '@/lib/dcc-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { owner, action, exe, stamp } = await req.json()
    if (typeof owner !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(owner)) return NextResponse.json({ error: 'Invalid camera session' }, { status: 400 })
    let status
    if (action === 'focus') return NextResponse.json(await dcc.autofocus(owner), { headers: { 'Cache-Control': 'no-store' } })
    if (action === 'off') status = await dcc.close(owner)
    else if (action === 'reset') status = await dcc.reset(owner)
    else if (action === 'on') {
      if (!Number.isSafeInteger(stamp) || stamp <= 0) throw new Error('Sesi kamera tidak valid')
      if (exe !== undefined) {
        if (typeof exe !== 'string') throw new Error('Lokasi DCC tidak valid')
        validateDccExe(exe)
      }
      status = await dcc.open(owner, exe, stamp)
    } else return NextResponse.json({ error: 'Invalid camera action' }, { status: 400 })
    return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ phase: 'error', message: e instanceof Error ? e.message : 'DCC gagal dihubungi' }, { status: 409 })
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (url.searchParams.has('status')) return NextResponse.json(dcc.snapshot(), { headers: { 'Cache-Control': 'no-store' } })
  const { frame, status } = await dcc.frame(url.searchParams.get('owner') ?? '')
  const headers = { 'Cache-Control': 'no-store', 'X-Camera-Phase': status.phase }
  if (!frame) return NextResponse.json(status, { status: 503, headers })
  return new NextResponse(new Uint8Array(frame), { headers: { ...headers, 'Content-Type': 'image/jpeg' } })
}

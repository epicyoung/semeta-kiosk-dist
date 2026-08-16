import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Sedot gambar template (R2 custom-domain) SERVER-SIDE — server gak kena CORS.
// Browser lalu fetch dari sini (same-origin) → nol CORS buat face detect + crop.
// Whitelist host biar gak jadi open proxy (SSRF): cuma R2/spindonesia + PocketBase lokal.
const ALLOWED_HOSTS = [
  'epic.spindonesia.com',
  'spindonesia.com',
  'epic-young.com',
]
function isAllowed(u: URL): boolean {
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true // PB lokal
  if (u.hostname.endsWith('.r2.dev') || u.hostname.endsWith('.r2.cloudflarestorage.com')) return true
  if (u.hostname.endsWith('.fal.media') || u.hostname === 'fal.media') return true
  if (u.hostname.endsWith('.fal.ai') || u.hostname === 'fal.ai') return true
  return ALLOWED_HOSTS.includes(u.hostname)
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url')
  if (!raw) return new NextResponse('Missing url', { status: 400 })

  let target: URL
  try { target = new URL(raw) } catch { return new NextResponse('Bad url', { status: 400 }) }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return new NextResponse('Bad scheme', { status: 400 })
  if (!isAllowed(target)) return new NextResponse('Host not allowed', { status: 403 })

  try {
    const upstream = await fetch(target.toString(), { cache: 'no-store' })
    if (!upstream.ok) return new NextResponse('Upstream failed', { status: 502 })
    const buf = await upstream.arrayBuffer()
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return new NextResponse('Fetch error', { status: 502 })
  }
}

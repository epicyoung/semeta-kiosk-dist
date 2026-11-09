import { NextRequest, NextResponse } from 'next/server'
import { assertLocalRead, boundedBytes } from '@/lib/local-request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PROXY_BYTES = 10 * 1024 * 1024
const DEFAULT_POCKETBASE_PORT = '8090'

function pocketbasePort(): string {
  try {
    const u = new URL(process.env.POCKETBASE_URL ?? '')
    return u.port || (u.protocol === 'https:' ? '443' : '80')
  } catch {
    return DEFAULT_POCKETBASE_PORT
  }
}

// Sedot gambar template (R2 custom-domain) SERVER-SIDE — server gak kena CORS.
// Browser lalu fetch dari sini (same-origin) → nol CORS buat face detect + crop.
// Whitelist host biar gak jadi open proxy (SSRF): cuma R2/spindonesia + PocketBase lokal.
const ALLOWED_HOSTS = [
  'epic.spindonesia.com',
  'spindonesia.com',
  'epic-young.com',
]
function isAllowed(u: URL): boolean {
  const h = u.hostname.toLowerCase()
  // PocketBase lokal: HANYA port 8090 + path /api/. Dulu any port = baca semua
  // service loopback (kiosk API sendiri, sidecar kamera, dll).
  if (h === 'localhost' || h === '127.0.0.1') {
    return u.port === pocketbasePort() && u.pathname.startsWith('/api/')
  }
  if (h.endsWith('.localhost')) return false
  if (h.endsWith('.r2.dev') || h.endsWith('.r2.cloudflarestorage.com')) return true
  if (h.endsWith('.fal.media') || h === 'fal.media') return true
  if (h.endsWith('.fal.ai') || h === 'fal.ai') return true
  return ALLOWED_HOSTS.includes(h)
}

export async function GET(req: NextRequest) {
  try { assertLocalRead(req) } catch (e) { return new NextResponse(e instanceof Error ? e.message : 'Ditolak', { status: 403 }) }
  const raw = req.nextUrl.searchParams.get('url')
  if (!raw) return new NextResponse('Missing url', { status: 400 })

  let target: URL
  try { target = new URL(raw) } catch { return new NextResponse('Bad url', { status: 400 }) }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return new NextResponse('Bad scheme', { status: 400 })
  if (!isAllowed(target)) return new NextResponse('Host not allowed', { status: 403 })

  try {
    const upstream = await fetch(target.toString(), {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (!upstream.ok) return new NextResponse('Upstream failed', { status: 502 })
    const buf = await boundedBytes(upstream, MAX_PROXY_BYTES)
    return new NextResponse(Buffer.from(buf), {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': target.port === pocketbasePort() ? 'no-store' : 'public, max-age=3600',
      },
    })
  } catch {
    return new NextResponse('Fetch error', { status: 502 })
  }
}

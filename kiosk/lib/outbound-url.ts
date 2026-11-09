/**
 * Shared outbound-URL policy. Dipakai route yang server-nya fetch URL dari caller
 * (finalize-video, save-local, sync) supaya ga jadi SSRF ke loopback/LAN.
 *
 * Aturan:
 * - production: wajib https, host publik (bukan localhost / IP private / link-local)
 * - development: http ke localhost boleh (buat testing worker lokal), private LAN tetap ditolak
 * - redirect TIDAK diikuti di caller (fetch harus pakai redirect:'error')
 */
import { lookup } from 'node:dns/promises'
import net from 'node:net'

const PRIVATE_V4 = [
  [/^10\./, '10.0.0.0/8'],
  [/^127\./, '127.0.0.0/8'],
  [/^169\.254\./, '169.254.0.0/16'],
  [/^172\.(1[6-9]|2\d|3[01])\./, '172.16.0.0/12'],
  [/^192\.168\./, '192.168.0.0/16'],
  [/^0\./, '0.0.0.0/8'],
] as const

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return true
  if (PRIVATE_V4.some(([re]) => re.test(h))) return true
  // IPv6 unique-local (fc00::/7) dan link-local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/i.test(h) || /^fe[89ab][0-9a-f]:/i.test(h)) return true
  return false
}

function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1'
}

/** URL fetch server-side yang aman dipanggil dari kiosk. Throw kalau ditolak. */
export function assertPublicHttpUrl(raw: string): URL {
  const u = new URL(raw)
  if (u.username || u.password) throw new Error('URL tidak boleh berisi kredensial')
  const dev = process.env.NODE_ENV !== 'production'
  // Dev boleh http ke loopback (worker lokal). https loopback tetap DITOLAK —
  // kiosk produksi ga boleh nembak service internal.
  const httpLocal = dev && u.protocol === 'http:' && isLoopback(u.hostname)
  if (u.protocol !== 'https:' && !httpLocal) throw new Error('URL harus https')
  if (isPrivateHost(u.hostname) && !httpLocal) throw new Error('URL ke alamat privat ditolak')
  return u
}

/** Cek IP literal (IPv4/IPv6) — dipakai buat hasil DNS. */
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address)
  if (family === 4) {
    return PRIVATE_V4.some(([re]) => re.test(address)) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)
  }
  if (family === 6) {
    const a = address.toLowerCase()
    if (a === '::1' || a === '::') return true
    if (a.startsWith('fc') || a.startsWith('fd')) return true // unique-local fc00::/7
    if (/^fe[89ab]/.test(a)) return true // link-local fe80::/10
    if (a.startsWith('::ffff:')) {
      const v4 = a.slice('::ffff:'.length)
      return net.isIP(v4) === 4 ? isPrivateAddress(v4) : true
    }
  }
  return false
}

/**
 * Versi async: resolve DNS dulu dan tolak kalau hostname nyasar ke IP privat
 * (DNS rebinding). fetch tetap pakai hostname asli; resolusi ganda masih mungkin,
 * tapi jalur paling murah (hostname -> 127.0.0.1 / 169.254.x) sudah ketutup.
 */
export async function assertPublicHttpUrlResolved(raw: string): Promise<URL> {
  const u = assertPublicHttpUrl(raw)
  const dev = process.env.NODE_ENV !== 'production'
  if (dev && u.protocol === 'http:' && isLoopback(u.hostname)) return u
  if (net.isIP(u.hostname)) return u // sudah divalidasi assertPublicHttpUrl
  let addresses: { address: string }[]
  try {
    addresses = await lookup(u.hostname, { all: true })
  } catch {
    throw new Error('DNS gagal — URL tidak bisa diverifikasi')
  }
  if (!addresses.length) throw new Error('DNS tidak menemukan alamat')
  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) throw new Error('URL mengarah ke alamat privat')
  }
  return u
}

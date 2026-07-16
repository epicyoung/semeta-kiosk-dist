import type { Face, FaceSlot } from './types'
import { browserDetect } from './browser-face-detect'

type BBox = { x: number; y: number; w: number; h: number }
type Provider = 'insightface' | 'browser'

// Gambar cross-origin (template R2 custom-domain) kena CORS di browser → route lewat
// /api/img-proxy (server sedot, same-origin serve). data:/blob:/same-origin dibiarin.
export function proxied(url: string): string {
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/')) return url
  try {
    const u = new URL(url, window.location.origin)
    if (u.origin === window.location.origin) return url // same-origin, no proxy
    return `/api/img-proxy?url=${encodeURIComponent(url)}`
  } catch {
    return url
  }
}

// ponytail: no cache — ping is 500ms max, stale provider state is worse than 1s overhead
// Boundary: kiosk gak kenal ComfyUI — deteksi = face_server (buffalo) else browser.
async function resolveProvider(): Promise<Provider> {
  try {
    const r = await fetch('http://localhost:8000/health', { signal: AbortSignal.timeout(500) })
    if (r.ok) return 'insightface'
  } catch {}
  return 'browser'
}

async function insightDetect(blob: Blob): Promise<BBox[]> {
  const fd = new FormData()
  fd.append('image', blob, 'face.jpg')
  const res = await fetch('http://localhost:8000/detect', { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`InsightFace detect: ${res.status}`)
  const { faces } = await res.json()
  return faces as BBox[]
}

async function detectBboxes(imageUrl: string): Promise<BBox[]> {
  const provider = await resolveProvider()
  const src = proxied(imageUrl) // cross-origin (R2 template) → lewat proxy same-origin
  if (provider === 'browser') return browserDetect(src)
  try {
    const blob = await fetch(src).then(r => r.blob())
    return await insightDetect(blob)
  } catch {
    // ponytail: fall through to browser if blob fetch / face_server fails
    return browserDetect(src)
  }
}

export function cropImage(imageUrl: string, bbox: { x: number; y: number; w: number; h: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const src = proxied(imageUrl) // cross-origin → proxy same-origin biar canvas ga tainted
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = bbox.w
      canvas.height = bbox.h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error(`Failed to load image: ${imageUrl}`))
    img.src = src
  })
}

export async function detectUserFaces(imageUrl: string): Promise<Face[]> {
  const boxes = await detectBboxes(imageUrl)
  return Promise.all(
    boxes.map(async (b, i) => ({
      id: String(i), x: b.x, y: b.y, w: b.w, h: b.h,
      cropUrl: await cropImage(imageUrl, b).catch(() => undefined),
    }))
  )
}

export async function detectTemplateSlots(thumbnailUrl: string): Promise<FaceSlot[]> {
  if (!thumbnailUrl) return []
  const boxes = await detectBboxes(thumbnailUrl)
  return boxes.map((b, i) => ({ id: `slot_${i}`, x: b.x, y: b.y, w: b.w, h: b.h }))
}

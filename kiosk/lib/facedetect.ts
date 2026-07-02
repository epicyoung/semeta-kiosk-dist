import type { Face, FaceSlot } from './types'
import { browserDetect } from './browser-face-detect'

type BBox = { x: number; y: number; w: number; h: number }
type Provider = 'insightface' | 'comfy' | 'browser'

// ponytail: no cache — ping is 500ms max, stale provider state is worse than 1s overhead
async function resolveProvider(): Promise<Provider> {
  try {
    const r = await fetch('http://localhost:8000/health', { signal: AbortSignal.timeout(500) })
    if (r.ok) return 'insightface'
  } catch {}
  try {
    const r = await fetch('http://localhost:8188/system_stats', { signal: AbortSignal.timeout(500) })
    if (r.ok) return 'comfy'
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

async function uploadToComfy(blob: Blob): Promise<string> {
  const fd = new FormData()
  fd.append('image', blob, 'face.jpg')
  fd.append('overwrite', 'true')
  const res = await fetch('http://localhost:8188/upload/image', { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`ComfyUI upload: ${res.status}`)
  const { name } = await res.json()
  return name as string
}

async function comfyDetect(imageName: string): Promise<BBox[]> {
  const workflow = await fetch('/faceanalysis.json').then(r => r.json())
  workflow.prompt['1'].inputs.image = imageName
  const promptRes = await fetch('http://localhost:8188/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow.prompt }),
  })
  const { prompt_id } = await promptRes.json()
  if (!prompt_id) throw new Error('ComfyUI rejected prompt')
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const history = await fetch(`http://localhost:8188/history/${prompt_id}`).then(r => r.json())
    const result = history[prompt_id]
    if (!result?.status?.completed) continue
    const boxes: BBox[] = result.outputs?.['2']?.bounding_boxes ?? []
    return boxes.sort((a, b) => a.x - b.x)
  }
  return []
}

async function detectBboxes(imageUrl: string): Promise<BBox[]> {
  const provider = await resolveProvider()
  if (provider === 'browser') return browserDetect(imageUrl)
  try {
    const blob = await fetch(imageUrl).then(r => r.blob())
    if (provider === 'insightface') return insightDetect(blob)
    const name = await uploadToComfy(blob)
    return comfyDetect(name)
  } catch {
    // ponytail: fall through to browser if blob fetch fails (e.g. CORS on template URL)
    return browserDetect(imageUrl)
  }
}

export function cropImage(imageUrl: string, bbox: { x: number; y: number; w: number; h: number }): Promise<string> {
  return new Promise((resolve, reject) => {
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
    img.src = imageUrl
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

import type { KioskConfig, Template } from './types'

// face_server :8000 = satu-satunya yang kenal ComfyUI. Kiosk cuma POST /stylize
// (multipart) dan nunggu JPEG balik — graph/WS/history hidup di face_server/comfy_client.py.

const STYLIZE_URL = 'http://localhost:8000/stylize'
const PCT_FLOOR = 10   // request ke-submit
const PCT_CEIL = 85    // sisanya buat decode hasil — caller nutup di 100 (pola sama localSwap)
const TICK_MS = 1_500  // server gak stream progress → tick sintetis biar bar gak beku
const TICK_STEP = 4

export type ComfyCfg = Pick<KioskConfig,
  'comfy_model_family' | 'comfy_checkpoint' | 'comfy_controlnet' | 'comfy_denoise' | 'comfy_face_lock'
  | 'comfy_sampler' | 'comfy_scheduler' | 'comfy_cfg' | 'comfy_steps' | 'comfy_cn_strength'>

// dataURL (capture) → Blob; URL biasa (dev) → fetch. Selfie gak pernah cross-origin.
async function toBlob(url: string): Promise<Blob> {
  if (!url.startsWith('data:')) return (await fetch(url)).blob()
  const [header, b64] = url.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

export async function comfyGenerate(
  selfieDataUrl: string,
  template: Template,
  cfg: ComfyCfg,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<string> {
  // Clamp monotonic — RenderCosmetics cuma butuh tick naik, bar gak boleh mundur
  let lastPct = 0
  const report = (pct: number) => {
    const p = Math.min(PCT_CEIL, Math.max(lastPct, pct))
    if (p > lastPct) { lastPct = p; onProgress(p) }
  }

  const fd = new FormData()
  fd.append('selfie', await toBlob(selfieDataUrl), 'selfie.jpg')
  fd.append('positive', template.positive_prompt ?? '')
  fd.append('negative', template.negative_prompt ?? '')
  fd.append('family', cfg.comfy_model_family ?? 'sd15')
  fd.append('checkpoint', cfg.comfy_checkpoint ?? 'epicrealism_pureEvolutionV5.safetensors')
  fd.append('controlnet', cfg.comfy_controlnet ?? 'canny')
  // Override kreatif per-template menang dari default global settings
  fd.append('denoise', String(template.denoise ?? cfg.comfy_denoise ?? 0.65))
  fd.append('face_lock', String(cfg.comfy_face_lock ?? true))
  // Sampler/scheduler/CFG override — kosong = face_server pakai default per family
  if (cfg.comfy_sampler) fd.append('sampler', cfg.comfy_sampler)
  if (cfg.comfy_scheduler) fd.append('scheduler', cfg.comfy_scheduler)
  if (cfg.comfy_cfg) fd.append('cfg', cfg.comfy_cfg)
  if (cfg.comfy_steps) fd.append('steps', cfg.comfy_steps)
  if (cfg.comfy_cn_strength) fd.append('cn_strength', cfg.comfy_cn_strength)

  report(PCT_FLOOR)
  const tick = setInterval(() => report(lastPct + TICK_STEP), TICK_MS)
  // Abort (timeout 120s / guest reset) → suruh face_server stop job ComfyUI-nya,
  // GPU jangan lanjut ngerjain hasil yang gak bakal dipake (retry ngantri di belakangnya).
  const onAbort = () => { void fetch(`${STYLIZE_URL}/interrupt`, { method: 'POST' }).catch(() => {}) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch(STYLIZE_URL, { method: 'POST', body: fd, signal })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`face_server /stylize ${res.status}: ${detail.slice(0, 300)}`)
    }
    return await blobToDataUrl(await res.blob())
  } finally {
    clearInterval(tick)
    signal.removeEventListener('abort', onAbort)
  }
}

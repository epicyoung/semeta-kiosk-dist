import type { VideoProvider } from '@/lib/types'

export type EngineKey = 'faceswap_local' | 'fullbody_local' | 'print_local' | 'faceswap_api' | 'fullbody_api'

export const ENGINE_OPTS: { value: EngineKey; label: string; soon?: boolean }[] = [
  { value: 'faceswap_local', label: 'Faceswap (LOCAL)' },
  { value: 'fullbody_local', label: 'Fullbody (LOCAL)' }, // = engine comfy stylize via face_server
  { value: 'print_local',    label: 'Photo Print (non-AI)' }, // photobooth klasik: overlay PNG + N shot, nol token
  { value: 'faceswap_api',   label: 'Faceswap (API) — soon',  soon: true },
  { value: 'fullbody_api',   label: 'Fullbody (API)' },
]
export const CAMERA_OPTS = [
  { value: 'webcam', label: 'Webcam (getUserMedia)' },
  { value: 'canon',  label: 'Canon (digiCamControl)' },
  // macOS/Linux — Windows ga punya gphoto2. Full-res, tanpa live view (PC Remote).
  // gphoto2 brand-agnostik: Canon EOS, Sony A7/ZV-E1, Nikon — semua masuk sini.
  { value: 'sony',   label: 'Canon / Sony (gphoto2, PC Remote)' },
]
// Stylize (face_server) — opsi asli dari GET :8000/capabilities, ini cuma label map.
export const COMFY_FAMILY_LABELS: Record<string, string> = { sd15: 'SD 1.5', sdxl: 'SDXL', flux: 'Flux' }
export const COMFY_CONTROLNET_LABELS: Record<string, string> = { canny: 'Canny (lines/outline)', depth: 'Depth (3D depth)', off: 'Off' }
// Sampler/scheduler — value '' = default per family. Allowlist sinkron sama comfy_client.py.
export const COMFY_SAMPLER_OPTS = [
  { value: '',                label: 'Default (per family)' },
  { value: 'dpmpp_2m',        label: 'DPM++ 2M' },
  { value: 'dpmpp_2m_sde',    label: 'DPM++ 2M SDE' },
  { value: 'dpmpp_sde',       label: 'DPM++ SDE' },
  { value: 'euler',           label: 'Euler' },
  { value: 'euler_ancestral', label: 'Euler a' },
  { value: 'ddim',            label: 'DDIM' },
  { value: 'uni_pc',          label: 'UniPC' },
]
export const COMFY_SCHEDULER_OPTS = [
  { value: '',            label: 'Default (per family)' },
  { value: 'karras',      label: 'Karras' },
  { value: 'normal',      label: 'Normal' },
  { value: 'simple',      label: 'Simple' },
  { value: 'sgm_uniform', label: 'SGM Uniform' },
  { value: 'exponential', label: 'Exponential' },
]
// CFG override — '' = default per family (sd15/sdxl 7). Server clamp 1-12, flux dikunci 1.0.
export const COMFY_CFG_OPTS = [
  { value: '', label: 'Default (per family)' },
  ...['3', '4', '5', '6', '7', '8', '9', '10'].map(v => ({ value: v, label: v })),
]
// Steps override — semua "aman", beda cuma speed vs detail halus. '' = default (sd15/sdxl 30).
// Server clamp 15-30, flux dikunci 20.
export const COMFY_STEPS_OPTS = [
  { value: '', label: 'Default (per family)' },
  ...['15', '20', '25', '30'].map(v => ({ value: v, label: v })),
]
// ControlNet strength override — '' = default 0.8. Server clamp 0.3-1.0.
export const COMFY_CN_STRENGTH_OPTS = [
  { value: '', label: 'Default (0.8)' },
  ...['0.3', '0.5', '0.6', '0.7', '0.8', '0.9', '1.0'].map(v => ({ value: v, label: v })),
]
export const COMFY_CONTROLNET_STRENGTH = 0.8 // fixed di face_server — hanya buat recipe line
// Video engine (img2vid) providers — semua lewat FAL, bedanya endpoint FAL per provider (Worker).
// HAPPYHORSE sengaja gak masuk list: OFF permanen (HPP mahal). Kalau mau balik, tambah di sini
// + isi harga di DEFAULT_VIDEO_COSTS + enable di /dashboard/settings. Server tetap gate via RPC.
// 3 tier doang (build B): Murah/Medium/Mahal. Sisanya (Vidu/Veo/WAN/Kling/HappyHorse) di-off dari
// UI — endpoint-nya masih di worker (video-provider.ts) kalau suatu saat mau dibalikin. Harga token
// di-append otomatis di map bawah (videoProviderOpts).
export const VIDEO_PROVIDER_OPTS: { value: VideoProvider; label: string }[] = [
  { value: 'LTX',      label: 'Budget — LTX 2.3'       },
  { value: 'PIXVERSE', label: 'Standard — PixVerse V6' },
  { value: 'SEEDANCE', label: 'Premium — Seedance Fast' },
]

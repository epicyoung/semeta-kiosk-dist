import type { VideoProvider } from '@/lib/types'

// Video engine kebuka atau engga — SATU sumber buat PreviewScreen, SettingsPanel, dan
// ProcessingScreen. Kebuka kalau super admin nyalain toggle Video kiosk ini
// (kiosks.enable_video, nyampe via handshake sebagai video_unlocked) ATAU godmode (testing).
// Client-side = deterrent doang; kunci asli fail-closed di RPC deduct_video_tokens.
export function isVideoUnlocked(cfg: { bypassed?: boolean; enable_video?: boolean }): boolean {
  return !!cfg.bypassed || !!cfg.enable_video
}

// Video engine (img2vid): hasil image terakhir → /api/generate-video (proxy Worker → FAL).
// FAIL-SAFE: gagal apa pun (offline/502/timeout/no-url) return null — TAMU TETEP DAPET FOTO.
// Caller (ProcessingScreen) lanjut SHOW_PREVIEW dengan foto still walau video null.
//
// ponytail: imageUrl dikirim apa adanya sebagai image_url ke FAL. Kalau itu dataURL, FAL nerima
// data URI. Kalau localhost/blob (hasil face_server lokal), FAL gak bisa akses → upstream 502,
// ketangkep di sini, foto tetep jalan. Upgrade: upload frame ke R2 dulu, kirim URL R2 publik.
export async function animateImage(
  imageUrl: string,
  provider: VideoProvider,
  opts?: { positive?: string; negative?: string; signal?: AbortSignal },
): Promise<string | null> {
  try {
    const res = await fetch('/api/generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        image_url: imageUrl,
        positive: opts?.positive,
        negative: opts?.negative,
      }),
      signal: opts?.signal,
    })
    if (!res.ok) return null
    const { video_url } = await res.json()
    return typeof video_url === 'string' && video_url ? video_url : null
  } catch {
    return null // offline / abort / bad json — semua non-fatal buat flow foto
  }
}

// Finalize: video mentah FAL → letterbox 2:3 + burn frame+QR (ffmpeg server) → blob URL lokal.
// FAIL-SAFE: gagal apa pun return null → caller tetep pakai video mentah (tamu ga kehilangan video).
export async function finalizeVideo(
  videoUrl: string,
  overlayPng: string | null,
  eventName: string,
  seq: string,
): Promise<string | null> {
  try {
    const res = await fetch('/api/finalize-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: videoUrl, overlay_png: overlayPng, event_name: eventName, seq }),
    })
    if (!res.ok) return null
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}

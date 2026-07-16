import type { KioskConfig } from './types'
import { localDb } from './local-db'
import { fetchPocketBaseFrames, fetchPocketBaseTemplates } from './pocketbase'
import { fetchSpindonesiaTemplates } from './spindonesia'
import { reasonForStatus, withinGrace, offlineLicensedFresh, type LockReason } from './license'

export type LicenseGate =
  | { ok: true; remaining_sec: number; licensed: boolean; bypassed?: boolean; kiosk_name?: string; kiosk_no?: number; pause_quota_sec?: number; pause_used_sec?: number }
  | { ok: false; reason: LockReason; message?: string }

// License gate — dipanggil di page.tsx (server) sebelum render. Worker = otoritas.
// Dev (no worker URL) = jalan penuh. Worker jawab non-200 = lock. Offline = grace 12 jam.
export async function checkLicenseGate(): Promise<LicenseGate> {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
  const secret = localDb.getSecret()
  // Dev mode: belum disetup buat licensing → jalan penuh tanpa lock.
  if (!workerUrl || !secret) return { ok: true, remaining_sec: 0, licensed: true }

  try {
    // machine_id di handshake PERTAMA (page.tsx, sebelum heartbeat) — TOFU kejadian di sini
    // duluan, jadi wajib bawa UUID asli. Kosong = TOFU nge-lock "" → mismatch ga pernah trip.
    const res = await fetch(`${workerUrl}/api/kiosk-handshake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ machine_id: localDb.getMachineId() }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    // 404 = no active session → freeware (jalan + watermark). 401/402/403 = hard lock.
    if (!res.ok) {
      if (res.status === 404) {
        // Freeware body bawa identity + force_lock (worker no-session branch).
        const fw = await res.json().catch(() => ({} as Record<string, unknown>))
        // Admin bisa takeover kiosk freeware → force_lock menang walau belum ada sewa.
        if (fw.force_locked === true) return { ok: false, reason: 'force_locked', message: (fw.lock_message as string) ?? undefined }
        return { ok: true, remaining_sec: 0, licensed: false, kiosk_name: fw.kiosk_name as string | undefined, kiosk_no: fw.kiosk_no as number | undefined }
      }
      return { ok: false, reason: reasonForStatus(res.status) }
    }

    const data = await res.json()
    if (data.status === 'bypassed' || data.bypassed) return { ok: true, remaining_sec: 0, licensed: true, bypassed: true }
    if (data.force_locked === true) return { ok: false, reason: 'force_locked', message: data.lock_message ?? undefined }

    const remaining = typeof data.remaining_sec === 'number' ? data.remaining_sec : 0
    // Prefer the worker's verdict; fall back to deriving it (same rule) for workers deployed
    // before the `licensed` field existed — otherwise a live rental would falsely watermark.
    const licensed = typeof data.licensed === 'boolean'
      ? data.licensed
      : data.status === 'ACTIVE' && remaining > 0
    localDb.saveLicense({ session_id: data.session_id ?? '', remaining_sec: remaining, lastOkAt: Date.now() })
    return {
      ok: true, remaining_sec: remaining, licensed,
      kiosk_name: data.kiosk_name, kiosk_no: data.kiosk_no,
      pause_quota_sec: typeof data.pause_quota_sec === 'number' ? data.pause_quota_sec : undefined,
      pause_used_sec: typeof data.pause_used_sec === 'number' ? data.pause_used_sec : undefined,
    }
  } catch {
    // Offline: sudah pernah aktivasi + masih dalam 12 jam → jalan pakai sisa lokal. Kalau tidak → lock.
    const rec = localDb.getLicense()
    // Lock gate: 12h grace (don't brick on a wifi blip). Watermark: tighter freshness —
    // stale cache → licensed:false so we don't give clean photos away unverified.
    if (withinGrace(rec, Date.now()))
      return { ok: true, remaining_sec: rec!.remaining_sec, licensed: offlineLicensedFresh(rec, Date.now()) }
    return { ok: false, reason: rec ? 'needs_reconfirm' : 'needs_activation' }
  }
}

const FALLBACK: KioskConfig = {
  brand_color: '#7c3aed',
  event_name: 'Demo Event',
  generation_source: 'LOCAL',
  templates: [],
  frames: [],
  enable_email: true,
  enable_print: true,
  enable_video: true,
  enable_gallery: false,
  template_source: 'pocketbase',
  pocketbase_url: 'http://localhost:8090',
  comfy_model_family: 'sd15',
  comfy_checkpoint: 'epicrealism_pureEvolutionV5.safetensors',
  comfy_controlnet: 'canny',
  comfy_denoise: 0.65,
  comfy_face_lock: true,
  video_defaults: {
    default_positive_prompt: 'smile and wave hand, subtle body movement, no camera movement, cinematic',
    default_negative_prompt: 'shaky camera, jump cut, distorted face, blur',
    max_duration_sec: 7,
  },
}

export async function fetchKioskConfig(): Promise<KioskConfig> {
  const localSettings = localDb.getSettings()
  const hasLocalSettings = Object.keys(localSettings).length > 0

  const templateSource = (localSettings.template_source as KioskConfig['template_source']) ?? 'pocketbase'
  const pbUrl = (localSettings.pocketbase_url as string) ?? 'http://localhost:8090'

  // Try PocketBase first (local, offline-capable after network boot)
  const [pbTemplates, pbFrames] = templateSource === 'pocketbase'
    ? await Promise.all([fetchPocketBaseTemplates(pbUrl), fetchPocketBaseFrames(pbUrl)])
    : [[], []]
  let templates = pbTemplates

  // JSON cache fallback
  if (templates.length === 0) templates = localDb.getTemplates()

  // Spindonesia (cloud-managed, pinned) di-prepend — selalu di depan, tenant gak bisa hapus.
  // Offline → cache terakhir; belum pernah online → []. Gak nge-block template lokal tenant.
  const spindonesia = await fetchSpindonesiaTemplates()

  if (hasLocalSettings || templates.length > 0 || spindonesia.length > 0) {
    const engineMode = localSettings.engine_mode as string | undefined
    // Always derive generation_source from engine_mode — never trust stale stored value
    const generation_source = engineMode?.endsWith('_local') ? 'LOCAL' : 'fal'
    // Mode = dunia template, jangan campur: FULLBODY (LOCAL) cuma nampilin template
    // comfy (dari sidecar), PRINT cuma template print (spindonesia ikut kesaring — flow-nya
    // gak kompatibel: print pilih layout dulu, AI foto dulu), mode lain non-comfy non-print.
    const all = [...spindonesia, ...templates]
    const modeTemplates = engineMode === 'print_local'
      ? all.filter(t => t.engine_type === 'print')
      : engineMode === 'fullbody_local'
        ? all.filter(t => t.engine_type === 'comfy')
        : all.filter(t => t.engine_type !== 'comfy' && t.engine_type !== 'print')
    return {
      ...FALLBACK,
      ...localSettings,
      generation_source,
      templates: modeTemplates,
      frames: pbFrames,
      template_local: localDb.getTemplateLocal(),
    }
  }

  // Nothing local at all — try worker (preserves existing deploy path)
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
  const secret = localDb.getSecret()
  if (!workerUrl || !secret) return FALLBACK

  try {
    const res = await fetch(`${workerUrl}/api/kiosk-config`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    })
    if (!res.ok) return FALLBACK
    const data = await res.json()
    return { ...FALLBACK, ...data }
  } catch {
    return FALLBACK
  }
}

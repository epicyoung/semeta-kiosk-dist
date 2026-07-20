import { fetchKioskConfig, checkLicenseGate } from '@/lib/kiosk-config'
import { localDb } from '@/lib/local-db'
import { KioskApp } from '@/components/KioskApp'

export const dynamic = 'force-dynamic'

export default async function Page() {
  // ponytail: no hard lock — kiosk selalu jalan, watermark ngikut licensed verdict.
  const gate = await checkLicenseGate()

  const config = await fetchKioskConfig()
  config.remaining_sec = gate.ok ? gate.remaining_sec : 0
  config.licensed = gate.ok ? gate.licensed : false
  config.bypassed = gate.ok ? (gate.bypassed ?? false) : false
  // Izin video per-kiosk = verdict Worker (kiosks.enable_video), BUKAN config lokal —
  // toggle super admin di Supabase nyampe tiap page load. Offline/dev = false (fail-closed);
  // godmode tetep kebuka via bypassed (isVideoUnlocked).
  config.enable_video = gate.ok ? (gate.video_unlocked ?? false) : false
  if (gate.ok) {
    config.kiosk_name = gate.kiosk_name
    config.kiosk_no = gate.kiosk_no
    config.pause_quota_sec = gate.pause_quota_sec
    config.pause_used_sec = gate.pause_used_sec
  }
  if (!gate.ok && gate.message) config.lock_message = gate.message
  const rawSecret = localDb.getSecret()
  config.has_secret = !!rawSecret
  config.secret_hint = rawSecret || undefined
  return (
    <>
      <style>{`:root { --brand-fg: #ffffff; }`}</style>
      <KioskApp config={config} />
    </>
  )
}

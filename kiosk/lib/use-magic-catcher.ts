'use client'
import { useEffect } from 'react'

// Pilihan durasi (detik) buat dropdown Settings. Default 15 kalau config kosong/invalid.
export const MAGIC_DURATIONS = [15, 30, 60, 90, 120, 180] as const
const DEFAULT_SEC = 15

// Records a reaction clip during the AI reveal, saved locally via /api/save-reaction.
// Stream is re-acquired fresh — LiveView's stream is already stopped by the time Preview mounts.
// AUDIO: direkam (vendor nyalain di Settings). Consent lewat disclaimer di IdleScreen — WAJIB.
// Fully self-cleaning: kamera + mic LED WAJIB mati pas unmount.
export function useMagicCatcher({
  enabled,
  eventName,
  deviceId,
  durationSec,
  audio,
}: {
  enabled: boolean
  eventName: string
  deviceId?: string
  durationSec?: number
  audio?: boolean
}): void {
  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return

    // Clamp ke pilihan valid — config lama / value hantu ga bikin durasi absurd.
    const sec = MAGIC_DURATIONS.includes(durationSec as typeof MAGIC_DURATIONS[number])
      ? (durationSec as number) : DEFAULT_SEC
    const maxMs = sec * 1000
    const wantAudio = audio === true

    let stream: MediaStream | null = null
    let recorder: MediaRecorder | null = null
    let stopTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    const chunks: BlobPart[] = []

    const mime = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm' : undefined

    // Kamera kepilih (Settings → Magic Catcher) dicoba EXACT dulu; kecabut/pindah port USB →
    // fallback kamera default — reaction kerekam kamera lain lebih baik daripada ga kerekam.
    // audio ikut flag vendor. Fallback tetep bawa audio biar konsisten sama consent yang dikasih.
    navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: wantAudio,
    }).catch(() =>
      navigator.mediaDevices.getUserMedia({ video: true, audio: wantAudio }),
    ).then(s => {
      if (cancelled) { s.getTracks().forEach(t => t.stop()); return }
      stream = s
      recorder = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s)
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        // Unmount (tamu Restart / keluar final) = clip TETEP disimpan walau kepotong < maxMs.
        // Dulu clip parsial dibuang → sesi pendek GA PERNAH nyimpen. LED tetep mati (cleanup).
        if (chunks.length === 0) return
        const blob = new Blob(chunks, { type: mime ?? 'video/webm' })
        // stamp client-side. Date.now() prefix biar unik lintas restart (performance.now() reset
        // ke 0 tiap reload → bisa tabrakan nama file antar sesi).
        const stamp = `${Date.now()}-${Math.round(performance.now())}`
        const fd = new FormData()
        fd.append('video', blob, 'reaction.webm')
        fd.append('event_name', eventName)
        fd.append('stamp', stamp)
        // Fire-and-forget — a failed reaction save must NEVER break the kiosk flow.
        fetch('/api/save-reaction', { method: 'POST', body: fd }).catch(() => {})
      }
      recorder.start()
      stopTimer = setTimeout(() => { if (recorder && recorder.state !== 'inactive') recorder.stop() }, maxMs)
    }).catch(() => { /* camera busy/denied → silently skip, kiosk unaffected */ })

    return () => {
      cancelled = true
      if (stopTimer) clearTimeout(stopTimer)
      try { if (recorder && recorder.state !== 'inactive') recorder.stop() } catch { /* noop */ }
      if (stream) stream.getTracks().forEach(t => t.stop())
    }
  }, [enabled, eventName, deviceId, durationSec, audio])
}

'use client'
import { useEffect } from 'react'

const MAX_MS = 15_000

// Records a muted reaction clip during the AI reveal, saved locally via /api/save-reaction.
// Stream is re-acquired fresh — LiveView's stream is already stopped by the time Processing mounts.
// Video ONLY, never audio (consent/legal). Fully self-cleaning: the camera LED must go dark on unmount.
export function useMagicCatcher({ enabled, eventName }: { enabled: boolean; eventName: string }): void {
  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return

    let stream: MediaStream | null = null
    let recorder: MediaRecorder | null = null
    let stopTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    const chunks: BlobPart[] = []

    const mime = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm' : undefined

    navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then(s => {
      if (cancelled) { s.getTracks().forEach(t => t.stop()); return }
      stream = s
      recorder = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s)
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        // Cancelled mid-record (unmount/reset) → jangan simpan clip parsial. LED tetep mati (di cleanup).
        if (cancelled || chunks.length === 0) return
        const blob = new Blob(chunks, { type: mime ?? 'video/webm' })
        // stamp client-side (route stays deterministic). Date.now() prefix biar unik lintas restart
        // (performance.now() reset ke 0 tiap reload → bisa tabrakan nama file antar sesi).
        const stamp = `${Date.now()}-${Math.round(performance.now())}`
        const fd = new FormData()
        fd.append('video', blob, 'reaction.webm')
        fd.append('event_name', eventName)
        fd.append('stamp', stamp)
        // Fire-and-forget — a failed reaction save must NEVER break the kiosk flow.
        fetch('/api/save-reaction', { method: 'POST', body: fd }).catch(() => {})
      }
      recorder.start()
      stopTimer = setTimeout(() => { if (recorder && recorder.state !== 'inactive') recorder.stop() }, MAX_MS)
    }).catch(() => { /* camera busy/denied → silently skip, kiosk unaffected */ })

    return () => {
      cancelled = true
      if (stopTimer) clearTimeout(stopTimer)
      try { if (recorder && recorder.state !== 'inactive') recorder.stop() } catch { /* noop */ }
      if (stream) stream.getTracks().forEach(t => t.stop())
    }
  }, [enabled, eventName])
}

'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CameraStatus } from './dcc-controller'

const labels: Record<string, string> = {
  idle: 'Live view istirahat', starting: 'Menyalakan live view…', live: 'Kamera siap',
  capturing: 'Mengambil foto…', recovering: 'Memulihkan kamera…', error: 'Cek daya/USB kamera dan DCC, lalu tekan R.',
  focusing: 'Menjalankan autofocus…',
}
let sessionStamp = 0
export function useCanonLive(active: boolean, paused = false, exe?: string) {
  const [status, setStatus] = useState<CameraStatus>({ phase: 'starting', message: labels.starting })
  const [src, setSrc] = useState<string>()
  const [retry, setRetry] = useState(0)
  const ownerRef = useRef('')
  const resetApplied = useRef(0)
  const focusBusy = useRef(false)
  const focusAbort = useRef<AbortController | null>(null)
  const [focusing, setFocusing] = useState(false)
  const [focusMessage, setFocusMessage] = useState('')
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const owner = useCallback(() => ownerRef.current, [])
  const reset = useCallback(() => setRetry(n => n + 1), [])
  const autofocus = useCallback(async () => {
    if (!active || pausedRef.current || status.phase !== 'live' || focusBusy.current) return
    const id = ownerRef.current
    const abort = new AbortController()
    focusAbort.current = abort
    focusBusy.current = true
    setFocusing(true)
    setFocusMessage('Menjalankan autofocus…')
    try {
      const r = await fetch('/api/canon-live', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: id, action: 'focus' }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.message || 'Autofocus belum berhasil.')
      if (!abort.signal.aborted && ownerRef.current === id) setFocusMessage(result.message)
    } catch (e) {
      if (!abort.signal.aborted && ownerRef.current === id) setFocusMessage(e instanceof Error ? e.message : 'Autofocus belum berhasil.')
    } finally {
      if (focusAbort.current === abort) {
        focusBusy.current = false
        setFocusing(false)
      }
    }
  }, [active, status.phase])

  useEffect(() => {
    if (!active) return
    const id = crypto.randomUUID()
    const stamp = sessionStamp = Math.max(Date.now(), sessionStamp + 1)
    ownerRef.current = id
    setFocusMessage('')
    setFocusing(false)
    focusBusy.current = false
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    let objectUrl: string | undefined
    const abort = new AbortController()
    setStatus({ phase: 'starting', message: labels.starting })
    setSrc(undefined)
    const control = async (action: string) => {
      const r = await fetch('/api/canon-live', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: id, action, stamp, ...(exe !== undefined ? { exe } : {}) }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
      })
      const state: CameraStatus = await r.json()
      if (!r.ok) throw new Error(state.message)
      return state
    }
    const poll = async () => {
      if (cancelled) return
      if (pausedRef.current || focusBusy.current) { timer = setTimeout(poll, 200); return }
      try {
        const r = await fetch(`/api/canon-live?owner=${id}`, { cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25_000)]) })
        if (cancelled) return
        if (r.ok && r.headers.get('Content-Type')?.startsWith('image/jpeg')) {
          const blob = await r.blob()
          if (cancelled) return
          const old = objectUrl
          objectUrl = URL.createObjectURL(blob)
          setSrc(objectUrl)
          if (old) URL.revokeObjectURL(old)
          const phase = (r.headers.get('X-Camera-Phase') ?? 'starting') as CameraStatus['phase']
          setStatus({ phase, message: labels[phase] ?? labels.starting })
        } else {
          const state: CameraStatus = await r.json()
          if (!cancelled) setStatus(state)
        }
      } catch {
        if (!cancelled) setStatus({ phase: 'error', message: 'Koneksi kamera terputus. Mencoba kembali…' })
      }
      if (!cancelled) timer = setTimeout(poll, 200)
    }
    void (async () => {
      try {
        const state = await control('on')
        if (!cancelled && retry > resetApplied.current) {
          await control('reset')
          if (!cancelled) resetApplied.current = retry
        }
        if (!cancelled) { setStatus(state); await poll() }
      } catch (e) {
        if (!cancelled) setStatus({ phase: 'error', message: e instanceof Error ? e.message : labels.error })
      }
    })()
    return () => {
      cancelled = true
      abort.abort()
      focusAbort.current?.abort()
      focusAbort.current = null
      focusBusy.current = false
      clearTimeout(timer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      void fetch('/api/canon-live', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: id, action: 'off' }), keepalive: true,
      }).catch(() => {})
    }
  }, [active, retry, exe])
  return { src, status, ready: active && !paused && !focusing && status.phase === 'live', reset, owner, autofocus, focusing, focusMessage }
}

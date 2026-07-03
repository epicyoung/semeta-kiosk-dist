'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Pings /api/heartbeat on an interval. Calls onRefill with remaining_sec on success.
 * Silent on error (offline-safe). First ping fires immediately on mount.
 */
import type { LockReason } from './license'

export function useHeartbeat(
  onResult: (sec: number, forceLocked: boolean, lockReason?: LockReason, lockMessage?: string) => void,
  intervalMs = 60 * 1000,
): void {
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  useEffect(() => {
    let cancelled = false

    async function ping() {
      try {
        const res = await fetch('/api/heartbeat', { method: 'POST', body: JSON.stringify({}), headers: { 'Content-Type': 'application/json' } })
        if (cancelled) return
        // Worker MENJAWAB non-200 (status 4xx) = verdict lisensi → lock. 503 = offline (callback decide grace).
        if (!res.ok) {
          if (res.status === 503) { onResultRef.current(-1, false, undefined); return } // offline sentinel
          const data = await res.json().catch(() => ({}))
          onResultRef.current(0, false, (data.reason as LockReason) ?? 'needs_activation')
          return
        }
        const data = await res.json()
        // ponytail: bypassed = dev mode, skip refill
        if (data.status === 'bypassed' || data.bypassed) return
        // freeware = 404 upstream (no active session) → jalan + watermark, bukan lock.
        // Kecuali admin force-lock: takeover menang walau tanpa sewa.
        if (data.freeware) {
          const lockMsg = data.force_locked === true ? (data.lock_message as string | undefined) : undefined
          onResultRef.current(0, data.force_locked === true, undefined, lockMsg)
          return
        }
        if (typeof data.remaining_sec === 'number') {
          const lockMsg = data.force_locked === true ? (data.lock_message as string | undefined) : undefined
          onResultRef.current(data.remaining_sec, data.force_locked === true, undefined, lockMsg)
        }
      } catch {
        // fetch ke route Next sendiri gagal (jarang) — treat sebagai offline
        if (!cancelled) onResultRef.current(-1, false, undefined)
      }
    }

    ping()
    const id = setInterval(ping, intervalMs)
    return () => { cancelled = true; clearInterval(id) }
  }, [intervalMs])
}

/**
 * Anti-cheat countdown using performance.now() — immune to OS clock manipulation.
 * ponytail: local-only for Phase 1; Phase 2 wires refill from Worker heartbeat.
 */
export function useCountdown(initialSec: number) {
  const [remainingSec, setRemaining] = useState(initialSec)
  const lastTick = useRef(performance.now())
  const paused = useRef(false)

  useEffect(() => {
    lastTick.current = performance.now() // reset on (re)mount
    const id = setInterval(() => {
      if (paused.current) {
        lastTick.current = performance.now()
        return
      }
      const now = performance.now()
      const elapsed = (now - lastTick.current) / 1000
      lastTick.current = now
      setRemaining(s => Math.max(0, s - elapsed))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const pause = useCallback(() => { paused.current = true }, [])

  const resume = useCallback(() => {
    lastTick.current = performance.now()
    paused.current = false
  }, [])

  return { remainingSec, isExpired: remainingSec <= 0, pause, resume, refill: setRemaining }
}

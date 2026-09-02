'use client'
import { useEffect, useRef, useState, useCallback, type Dispatch, type ReactNode } from 'react'
import type { KioskAction, KioskState } from '@/lib/types'

const ENABLED = process.env.NODE_ENV !== 'development' // ponytail: dev gak auto-reset, prod & test nyala

type Props = {
  screen: KioskState['screen']
  dispatch: Dispatch<KioskAction>
  children: ReactNode
}

export function InactivityReset({ screen, dispatch, children }: Props) {
  const [warning, setWarning] = useState(false)
  const warnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const resetTimers = useCallback(() => {
    clearTimeout(warnTimer.current)
    clearTimeout(resetTimer.current)
    setWarning(false)
    if (!ENABLED || screen === 'idle') return
    // Auto idle reset: 5 menit (300_000ms) tanpa sentuhan → kembali ke home screen (idle).
    const resetMs = 300_000
    warnTimer.current = setTimeout(() => setWarning(true), resetMs - 10_000)
    resetTimer.current = setTimeout(() => dispatch({ type: 'RESET' }), resetMs)
  }, [screen, dispatch])

  useEffect(() => {
    resetTimers()
    window.addEventListener('pointerdown', resetTimers)
    return () => {
      window.removeEventListener('pointerdown', resetTimers)
      clearTimeout(warnTimer.current)
      clearTimeout(resetTimer.current)
    }
  }, [resetTimers])

  return (
    <>
      {children}
      {warning && (
        <div className="fixed bottom-8 inset-x-0 flex justify-center z-50 pointer-events-none">
          <div style={{ background: 'rgba(9,1,53,0.85)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', fontSize: 'var(--text-sm)', padding: '12px 24px', borderRadius: 12 }}>
            Sesi berakhir dalam 10 detik...
          </div>
        </div>
      )}
    </>
  )
}

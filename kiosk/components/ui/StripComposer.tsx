'use client'

import { useState, useRef } from 'react'
import { useT } from '@/lib/i18n'
import { TouchButton } from './TouchButton'
import type { StripSource } from '@/lib/strip-pool'
import type { SlotTransform } from '@/lib/print-layout'

type Props = {
  pool: StripSource[]
  slots: number
  printing: boolean
  error: boolean
  overlayUrl?: string | null
  onCancel: () => void
  onConfirm: (picked: { source: StripSource; transform: SlotTransform }[]) => void
}

export function StripComposer({ pool, slots, printing, error, overlayUrl, onCancel, onConfirm }: Props) {
  const t = useT()
  const [picked, setPicked] = useState<string[]>([])
  const [transforms, setTransforms] = useState<Record<number, { scale: number; x: number; y: number; fit: 'cover' | 'contain'; rotation: number }>>({})
  const [activeSlot, setActiveSlot] = useState<number | null>(null)

  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null)
  const isDraggingRef = useRef(false)

  const slotOf = (id: string) => picked.indexOf(id)
  const isFull = picked.length >= slots

  const getTransform = (i: number) => transforms[i] || { scale: 1, x: 0, y: 0, fit: 'cover', rotation: 0 }

  const fill = (id: string) => {
    if (printing || isFull || picked.includes(id)) return
    const nextPicked = [...picked, id]
    setPicked(nextPicked)
    setActiveSlot(nextPicked.length - 1)
  }

  const clear = (i: number) => {
    if (printing) return
    setPicked(picked.filter((_, j) => j !== i))
    setTransforms(prev => {
      const next = { ...prev }
      delete next[i]
      return next
    })
    if (activeSlot === i) setActiveSlot(null)
  }

  const handlePointerDown = (i: number, e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // safe fallback
    }
    setActiveSlot(i)
    isDraggingRef.current = true
    const current = getTransform(i)
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startX: current.x,
      startY: current.y,
    }
  }

  const handlePointerMove = (i: number, e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (!isDraggingRef.current || !start) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const deltaX = (e.clientX - start.pointerX) / rect.width
    const deltaY = (e.clientY - start.pointerY) / rect.height
    const targetX = Math.max(-1.0, Math.min(1.0, start.startX + deltaX))
    const targetY = Math.max(-1.0, Math.min(1.0, start.startY + deltaY))

    setTransforms(prev => {
      const current = prev[i] || { scale: 1, x: 0, y: 0, fit: 'cover', rotation: 0 }
      return {
        ...prev,
        [i]: {
          ...current,
          x: targetX,
          y: targetY,
        },
      }
    })
  }

  const handlePointerUp = (e?: React.PointerEvent<HTMLDivElement>) => {
    if (e?.currentTarget && typeof e.currentTarget.releasePointerCapture === 'function') {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // safe fallback
      }
    }
    isDraggingRef.current = false
    dragStartRef.current = null
  }

  const adjustScale = (i: number, delta: number) => {
    setTransforms(prev => {
      const current = prev[i] || { scale: 1, x: 0, y: 0, fit: 'cover', rotation: 0 }
      const newScale = Math.max(0.5, Math.min(3.5, Number((current.scale + delta).toFixed(2))))
      return { ...prev, [i]: { ...current, scale: newScale } }
    })
  }

  const toggleFit = (i: number) => {
    setTransforms(prev => {
      const current = prev[i] || { scale: 1, x: 0, y: 0, fit: 'cover', rotation: 0 }
      const nextFit = current.fit === 'contain' ? 'cover' : 'contain'
      return { ...prev, [i]: { ...current, fit: nextFit, scale: 1, x: 0, y: 0 } }
    })
  }

  const rotate90 = (i: number) => {
    setTransforms(prev => {
      const current = prev[i] || { scale: 1, x: 0, y: 0, fit: 'cover', rotation: 0 }
      const nextRotation = (current.rotation + 90) % 360
      return { ...prev, [i]: { ...current, rotation: nextRotation } }
    })
  }

  const resetTransform = (i: number) => {
    setTransforms(prev => ({ ...prev, [i]: { scale: 1, x: 0, y: 0, fit: 'cover', rotation: 0 } }))
  }

  const confirm = () => {
    if (printing || picked.length === 0) return
    onConfirm(
      picked.map((id, i) => ({
        source: pool.find(p => p.id === id)!,
        transform: getTransform(i),
      }))
    )
  }

  return (
    <div className="fixed inset-0 z-[60] animate-fade-in" style={{ background: 'rgba(9,1,53,0.94)', backdropFilter: 'blur(20px)' }}>
      <div className="flex h-full w-full gap-8 p-8 max-[900px]:gap-5 max-[900px]:p-5">

        {/* Strip Preview 1:3 */}
        <div className="flex h-full flex-none flex-col items-center justify-center">
          <div
            className="relative overflow-hidden rounded-[8px]"
            style={{ aspectRatio: '1 / 3', height: 'min(78vh, 100%)', background: '#0a0a0a', boxShadow: '0 24px 60px rgba(0,0,0,0.65)' }}
          >
            {/* Frame Overlay (Live preview overlay 600x1800) */}
            {overlayUrl && (
              <img
                src={overlayUrl}
                alt="Overlay"
                className="absolute inset-0 z-20 h-full w-full object-cover pointer-events-none"
              />
            )}

            {Array.from({ length: slots }, (_, i) => {
              const src = picked[i] ? pool.find(p => p.id === picked[i]) : undefined
              const tf = getTransform(i)

              return (
                <div
                  key={i}
                  className="relative block w-full overflow-hidden"
                  style={{ height: `${100 / slots}%`, background: src ? 'transparent' : 'rgba(255,255,255,0.05)' }}
                >
                  {src ? (
                    <div className="relative h-full w-full overflow-hidden">
                      {/* Interactive Drag & Zoom Photo Container */}
                      <div
                        onPointerDown={(e) => handlePointerDown(i, e)}
                        onPointerMove={(e) => handlePointerMove(i, e)}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                        className="h-full w-full touch-none cursor-grab active:cursor-grabbing flex items-center justify-center"
                      >
                        <img
                          src={src.thumbUrl}
                          alt=""
                          draggable={false}
                          className="h-full w-full select-none pointer-events-none transition-transform duration-75"
                          style={{
                            objectFit: tf.fit,
                            transform: `translate(${tf.x * 100}%, ${tf.y * 100}%) scale(${tf.scale}) rotate(${tf.rotation}deg)`,
                            transformOrigin: 'center center',
                          }}
                        />
                      </div>

                      {/* Header Controls (Zoom Badge + Fit Toggle + Delete) */}
                      <div className="absolute inset-x-1 top-1 z-30 flex items-center justify-between pointer-events-auto">
                        <div className="flex items-center gap-0.5">
                          <span className={`flex items-center gap-1 rounded-full text-white backdrop-blur-md ${slots >= 3 ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[10px]'}`} style={{ background: 'rgba(0,0,0,0.65)' }}>
                            🔍 {(tf.scale * 100).toFixed(0)}%
                          </span>
                          <button
                            onClick={() => toggleFit(i)}
                            title="Toggle Fit Mode (Full vs Cover)"
                            className={`rounded-full text-white backdrop-blur-md transition-colors active:scale-95 ${slots >= 3 ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[10px]'}`}
                            style={{ background: tf.fit === 'contain' ? 'rgba(79,70,229,0.9)' : 'rgba(0,0,0,0.65)' }}
                          >
                            {tf.fit === 'contain' ? '🔲 Full' : '🖼️ Cover'}
                          </button>
                        </div>
                        <button
                          onClick={() => clear(i)}
                          className={`flex items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-95 ${slots >= 3 ? 'h-5 w-5 text-xs' : 'h-7 w-7 text-sm'}`}
                          style={{ background: 'rgba(220,38,38,0.85)', lineHeight: 1 }}
                        >
                          ×
                        </button>
                      </div>

                      {/* Footer Controls (Zoom +/- & Rotate 90° & Reset) */}
                      <div className="absolute inset-x-1 bottom-1 z-30 flex items-center justify-center gap-1 pointer-events-auto">
                        <button
                          onClick={() => adjustScale(i, -0.15)}
                          title="Zoom Out"
                          className={`flex items-center justify-center rounded-full bg-black/75 text-white shadow backdrop-blur-md active:scale-90 ${slots >= 3 ? 'h-5 w-5 text-[10px]' : 'h-7 w-7 text-xs'}`}
                        >
                          −
                        </button>
                        <button
                          onClick={() => rotate90(i)}
                          title="Rotate 90°"
                          className={`flex items-center justify-center rounded-full bg-black/75 text-white shadow backdrop-blur-md active:scale-90 ${slots >= 3 ? 'h-5 px-1 text-[8px]' : 'h-7 px-1.5 text-[10px]'}`}
                        >
                          🔄 {tf.rotation}°
                        </button>
                        <button
                          onClick={() => resetTransform(i)}
                          title="Reset"
                          className={`flex items-center justify-center rounded-full bg-black/75 text-white shadow backdrop-blur-md active:scale-90 ${slots >= 3 ? 'h-5 px-1 text-[8px]' : 'h-7 px-1.5 text-[10px]'}`}
                        >
                          ↺
                        </button>
                        <button
                          onClick={() => adjustScale(i, 0.15)}
                          title="Zoom In"
                          className={`flex items-center justify-center rounded-full bg-black/75 text-white shadow backdrop-blur-md active:scale-90 ${slots >= 3 ? 'h-5 w-5 text-[10px]' : 'h-7 w-7 text-xs'}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span
                      className="absolute inset-2 z-10 flex items-center justify-center rounded-[4px]"
                      style={{ border: '2px dashed rgba(255,255,255,0.25)', color: 'rgba(255,255,255,0.4)', fontSize: 'var(--text-2xl)', fontWeight: 600 }}
                    >
                      {i + 1}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right Panel: Photo Picker & Action buttons */}
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, textWrap: 'balance' }}>{t('strip_title') as string}</h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)', margin: '6px 0 0' }}>
            {isFull ? (t('strip_hint_full') as string) : (t('strip_hint') as string)}
          </p>

          <div className="mt-5 flex-1 overflow-y-auto">
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              {pool.map(src => {
                const at = slotOf(src.id)
                const used = at >= 0
                return (
                  <button
                    key={src.id}
                    onClick={() => fill(src.id)}
                    disabled={used || isFull || printing}
                    className="relative overflow-hidden rounded-[10px] transition-transform duration-200 active:scale-[0.96]"
                    style={{
                      aspectRatio: '3 / 4',
                      border: used ? '2px solid var(--brand)' : '1px solid rgba(255,255,255,0.14)',
                      opacity: used ? 0.4 : isFull ? 0.55 : 1,
                      cursor: used || isFull ? 'default' : 'pointer',
                    }}
                  >
                    <img src={src.thumbUrl} alt="" className="h-full w-full object-cover" />
                    {used && (
                      <span
                        className="absolute left-2 top-2 flex h-10 w-10 items-center justify-center rounded-full"
                        style={{ background: 'var(--brand)', color: 'var(--brand-fg)', fontSize: 'var(--text-lg)', fontWeight: 700 }}
                      >{at + 1}</span>
                    )}
                    <span
                      className="absolute inset-x-0 bottom-0 py-1.5 text-center"
                      style={{ background: 'rgba(9,1,53,0.72)', fontSize: 'var(--text-xs)', color: 'var(--fg)' }}
                    >{src.kind === 'original' ? (t('strip_label_original') as string) : (t('strip_label_ai') as string)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-5 flex-none">
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)', margin: '0 0 10px' }}>
              💡 Untuk foto Landscape: tap 🔲 <b>Full Fit</b> agar foto utuh tanpa terpotong, atau 🔄 <b>Rotate 90°</b> untuk memutar foto.
            </p>
            {error && (
              <p role="alert" style={{ fontSize: 'var(--text-sm)', color: '#ff8a8a', margin: '0 0 10px' }}>
                {t('strip_print_failed') as string}
              </p>
            )}
            <div className="flex gap-3">
              <TouchButton variant="ghost" onClick={onCancel} disabled={printing} className="flex-none px-8">
                {t('preview_print_cancel') as string}
              </TouchButton>
              <TouchButton
                onClick={confirm}
                disabled={picked.length === 0 || printing}
                className="flex-1"
                style={{ background: 'var(--brand)', color: 'var(--brand-fg)' }}
              >
                {printing ? (t('preview_printing') as string) : (t('strip_print_btn') as string)}
              </TouchButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

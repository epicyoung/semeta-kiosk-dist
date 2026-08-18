'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/lib/i18n'
import { TouchButton } from './TouchButton'
import type { Ai4RLayout, Ai4ROrientation } from '@/lib/types'
import type { StripSource } from '@/lib/strip-pool'
import { composerSlotCount, type SlotTransform } from '@/lib/print-layout'

type PrintLayoutMode = '2R_STRIP' | '4R_LANDSCAPE'

type Props = {
  pool: StripSource[]
  slots: number
  printing: boolean
  error: boolean
  overlayUrl?: string | null
  overlayRightUrl?: string | null
  overlay4rUrl?: string | null
  customSlots?: { slots: { x: number; y: number; w: number; h: number; r?: number }[] } | null
  custom4rSlots?: { slots: { x: number; y: number; w: number; h: number; r?: number }[] } | null
  ai4rLayout?: Ai4RLayout
  ai4rOrientation?: Ai4ROrientation
  require4rOverlay?: boolean
  onCancel: () => void
  onConfirm: (
    picked: { source: StripSource; transform: SlotTransform }[],
    mode: PrintLayoutMode
  ) => void
}

export function StripComposer({
  pool,
  slots,
  printing,
  error,
  overlayUrl,
  overlayRightUrl,
  overlay4rUrl,
  customSlots,
  custom4rSlots,
  ai4rLayout = 'GRID_4',
  ai4rOrientation = 'LANDSCAPE',
  require4rOverlay = false,
  onCancel,
  onConfirm,
}: Props) {
  const t = useT()
  const [mode, setMode] = useState<PrintLayoutMode>('2R_STRIP')
  // Array PANJANG TETAP sepanjang jumlah slot, `null` = slot kosong. Dulu ini array padat
  // yang di-splice pas hapus, jadi buang slot 1 bikin isi 2/3/4 naik semua — foto pindah
  // tempat sendiri padahal tamu cuma mau ngosongin satu. Index = slot, titik.
  const [picked, setPicked] = useState<(string | null)[]>(() => Array(slots).fill(null))
  type FitAxis = 'width' | 'height'
  const [transforms, setTransforms] = useState<Record<number, { scale: number; x: number; y: number; fit: FitAxis; rotation: number }>>({})
  const [activeSlot, setActiveSlot] = useState<number | null>(null)

  const TAP_SLOP_PX = 8
  const poolRef = useRef<HTMLDivElement | null>(null)
  const poolDragRef = useRef<{ startX: number; startScroll: number; moved: number } | null>(null)

  const handlePoolDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || !poolRef.current) return
    poolDragRef.current = { startX: e.clientX, startScroll: poolRef.current.scrollLeft, moved: 0 }
  }

  const handlePoolMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = poolDragRef.current
    if (!d || !poolRef.current) return
    const dx = e.clientX - d.startX
    d.moved = Math.max(d.moved, Math.abs(dx))
    poolRef.current.scrollLeft = d.startScroll - dx
  }

  const handlePoolUpCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = poolDragRef.current
    poolDragRef.current = null
    if (d && d.moved > TAP_SLOP_PX) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const [panel, setPanel] = useState<HTMLElement | null>(null)
  useEffect(() => setPanel(document.getElementById('glass-panel')), [])

  const is4R = mode === '4R_LANDSCAPE'
  const isPortrait4R = is4R && ai4rOrientation === 'PORTRAIT'
  const hasCustom2Strip = !is4R && !!customSlots?.slots && customSlots.slots.length > 0
  const hasCustom4R = is4R && !!custom4rSlots?.slots && custom4rSlots.slots.length > 0

  const slotCountFor = (m: PrintLayoutMode) =>
    composerSlotCount(m, {
      slots,
      ai4rLayout,
      customSlotCount: customSlots?.slots?.length,
      custom4rSlotCount: custom4rSlots?.slots?.length,
    })

  const activeSlots = slotCountFor(mode)
  const activeOverlay = is4R ? overlay4rUrl : overlayUrl

  const [isSingleStripOverlay, setIsSingleStripOverlay] = useState(false)

  useEffect(() => {
    if (!overlayUrl) {
      setIsSingleStripOverlay(false)
      return
    }
    const img = new Image()
    img.onload = () => {
      setIsSingleStripOverlay(img.naturalWidth / img.naturalHeight < 0.45)
    }
    img.src = overlayUrl
  }, [overlayUrl])

  const layoutName = is4R
    ? hasCustom4R
      ? `Custom (${custom4rSlots!.slots.length} Slot)`
      : ai4rLayout === 'SINGLE_1' ? '1 Full Bleed'
      : ai4rLayout === 'TRIO_3' ? '1+2 Trio'
      : ai4rLayout === 'GRID_3' ? (isPortrait4R ? '3 Stack' : '3 Grid')
      : ai4rLayout === 'SPLIT_2' ? '2 Split'
      : '2×2 Grid'
    : hasCustom2Strip
    ? `Custom (${customSlots!.slots.length} Slot)`
    : `${slots} Slot Strip`

  const fourRLocked = require4rOverlay && !overlay4rUrl
  // Slice ke activeSlots: entri yang lagi kesembunyiin (mode kecil) JANGAN dibaca "kepakai" —
  // kartunya harus bisa dipilih lagi buat slot yang keliatan, bukan nampilin badge nomor
  // slot yang ga ada di layar.
  const slotOf = (id: string) => picked.slice(0, activeSlots).indexOf(id)
  const filled = picked.slice(0, activeSlots).filter(Boolean).length
  const isFull = filled >= activeSlots

  const getTransform = (i: number) => transforms[i] || { scale: 1, x: 0, y: 0, fit: 'width' as FitAxis, rotation: 0 }

  const handleModeSwitch = (nextMode: PrintLayoutMode) => {
    if (printing || nextMode === mode) return
    if (nextMode === '4R_LANDSCAPE' && fourRLocked) return
    setMode(nextMode)
    // Array-nya dipanjangin ke MAX dua mode, ga dipotong ke mode tujuan. Pindah ke layout
    // yang slotnya lebih sedikit cuma NYEMBUNYIIN kelebihannya (semua pembaca udah slice ke
    // activeSlots); balik lagi ke layout gede, pilihan tamu utuh. Kalau dipotong beneran,
    // bolak-balik tab = pilihan ilang permanen tanpa ada yang ngasih tau.
    const keep = Math.max(slotCountFor(mode), slotCountFor(nextMode))
    setPicked(Array.from({ length: keep }, (_, i) => picked[i] ?? null))
  }

  const fill = (id: string) => {
    if (printing || slotOf(id) >= 0) return
    const at = picked.slice(0, activeSlots).findIndex(p => p === null)
    if (at < 0) return
    const next = [...picked]
    next[at] = id
    setPicked(next)
    setActiveSlot(at)
  }

  const clear = (i: number) => {
    if (printing) return
    const next = [...picked]
    next[i] = null
    setPicked(next)
    setTransforms(prev => {
      const n = { ...prev }
      delete n[i]
      return n
    })
    if (activeSlot === i) setActiveSlot(null)
  }

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null)
  const dragStartRef = useRef<{ x: number; y: number; initialTfX: number; initialTfY: number } | null>(null)
  const isDraggingRef = useRef(false)
  const lastTapRef = useRef<{ slot: number; at: number; x: number; y: number } | null>(null)
  const DOUBLE_TAP_MS = 350
  const MIN_SCALE = 0.5
  const MAX_SCALE = 3.5
  const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number(s.toFixed(2))))

  const flipFit = (i: number) => {
    setTransforms(prev => {
      const current = prev[i] || { scale: 1, x: 0, y: 0, fit: 'width' as FitAxis, rotation: 0 }
      const next: FitAxis = current.fit === 'width' ? 'height' : 'width'
      return { ...prev, [i]: { ...current, fit: next, scale: 1, x: 0, y: 0 } }
    })
  }

  const handlePointerDown = (i: number, e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setActiveSlot(i)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = { startDist: Math.hypot(a.x - b.x, a.y - b.y), startScale: getTransform(i).scale }
    } else {
      isDraggingRef.current = true
      const current = getTransform(i)
      dragStartRef.current = { x: e.clientX, y: e.clientY, initialTfX: current.x, initialTfY: current.y }
    }
  }

  const handlePointerMove = (i: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchRef.current.startDist > 0) {
        const factor = dist / pinchRef.current.startDist
        const nextScale = clampScale(pinchRef.current.startScale * factor)
        setTransforms(prev => ({ ...prev, [i]: { ...(prev[i] || { x: 0, y: 0, fit: 'width', rotation: 0 }), scale: nextScale } }))
      }
      return
    }

    if (isDraggingRef.current && dragStartRef.current) {
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      const rect = e.currentTarget.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        const lim = Math.max(1, getTransform(i).scale)
        const nextX = Math.max(-lim, Math.min(lim, dragStartRef.current.initialTfX + (dx / rect.width)))
        const nextY = Math.max(-lim, Math.min(lim, dragStartRef.current.initialTfY + (dy / rect.height)))
        setTransforms(prev => ({ ...prev, [i]: { ...(prev[i] || { scale: 1, fit: 'width', rotation: 0 }), x: nextX, y: nextY } }))
      }
    }
  }

  const handlePointerUp = (i: number, e: React.PointerEvent<HTMLDivElement>) => {
    const wasPinching = pinchRef.current !== null
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null

    const start = dragStartRef.current
    const moved = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : Infinity

    if (pointersRef.current.size === 0) {
      isDraggingRef.current = false
      dragStartRef.current = null
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}

    if (!wasPinching && moved <= TAP_SLOP_PX) {
      const now = Date.now()
      const last = lastTapRef.current
      if (last && last.slot === i && now - last.at <= DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= TAP_SLOP_PX * 3) {
        flipFit(i)
        lastTapRef.current = null
      } else {
        lastTapRef.current = { slot: i, at: now, x: e.clientX, y: e.clientY }
      }
    }
  }

  const handleWheel = (i: number, e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const current = getTransform(i)
    setTransforms(prev => ({ ...prev, [i]: { ...current, scale: clampScale(current.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)) } }))
  }

  const rotateSlot = (i: number) => {
    setTransforms(prev => {
      const current = prev[i] || { scale: 1, x: 0, y: 0, fit: 'width', rotation: 0 }
      return { ...prev, [i]: { ...current, rotation: (current.rotation + 90) % 360 } }
    })
  }

  const renderSlot = (i: number, side: 'left' | 'right' | 'single' = 'single', rect?: { x: number; y: number; w: number; h: number; r?: number }, containerW?: number, containerH?: number) => {
    const src = picked[i] ? pool.find(p => p.id === picked[i]) : undefined
    const tf = getTransform(i)
    const isTrioHero = is4R && ai4rLayout === 'TRIO_3' && i === 0

    const customStyle: React.CSSProperties = rect && containerW && containerH
      ? { position: 'absolute', left: `${(rect.x / containerW) * 100}%`, top: `${(rect.y / containerH) * 100}%`, width: `${(rect.w / containerW) * 100}%`, height: `${(rect.h / containerH) * 100}%`, transform: rect.r ? `rotate(${rect.r}deg)` : undefined, ['--checker-size' as string]: '10px' }
      : { ['--checker-size' as string]: is4R || activeSlots >= 3 ? '10px' : '14px' }

    return (
      <div
        key={`${side}-${i}`}
        className={`block overflow-hidden border border-white/5 checker ${src ? '' : 'checker--void'} ${rect ? 'absolute' : (is4R ? 'h-full relative w-full' : 'flex-1 min-h-0 relative w-full')} ${isTrioHero ? 'col-span-2 row-span-1' : ''}`}
        style={customStyle}
        onPointerDown={() => setActiveSlot(i)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          flipFit(i)
        }}
      >
        {src ? (
          <div className="relative h-full w-full overflow-hidden">
            <div
              onPointerDown={(e) => handlePointerDown(i, e)}
              onPointerMove={(e) => handlePointerMove(i, e)}
              onPointerUp={(e) => handlePointerUp(i, e)}
              onPointerCancel={(e) => handlePointerUp(i, e)}
              onWheel={(e) => handleWheel(i, e)}
              className="h-full w-full touch-none cursor-grab active:cursor-grabbing flex items-center justify-center"
            >
              <img
                src={src.thumbUrl}
                alt=""
                draggable={false}
                className="max-w-none select-none pointer-events-none transition-transform duration-75"
                style={{
                  width: tf.fit === 'width' ? '100%' : 'auto',
                  height: tf.fit === 'width' ? 'auto' : '100%',
                  transform: `translate(${tf.x * 100}%, ${tf.y * 100}%) scale(${tf.scale}) rotate(${tf.rotation}deg)`,
                }}
              />
            </div>
          </div>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center font-bold text-white/20">{i + 1}</span>
        )}
      </div>
    )
  }

  // Kontrol slot (badge fit/scale + rotate + clear) dirender di layer z-30 TERPISAH
  // di atas overlay PNG (z-20), bukan di dalam wadah slot foto.
  // Dengan begini:
  // 1. Foto tetep rapi di bawah overlay frame (z-10).
  // 2. Overlay PNG ada di tengah (z-20, pointer-events-none).
  // 3. Badge & tombol rotate/delete SELALU terapung di atas overlay (z-30), ga akan pernah
  //    ketutup logo/teks/art frame PNG, dan 100% bisa diklik.
  const renderControls = (
    i: number,
    rect?: { x: number; y: number; w: number; h: number; r?: number },
    containerW?: number,
    containerH?: number
  ) => {
    const src = picked[i] ? pool.find(p => p.id === picked[i]) : undefined
    const tf = getTransform(i)
    const isTrioHero = is4R && ai4rLayout === 'TRIO_3' && i === 0

    const customStyle: React.CSSProperties = rect && containerW && containerH
      ? {
          position: 'absolute',
          left: `${(rect.x / containerW) * 100}%`,
          top: `${(rect.y / containerH) * 100}%`,
          width: `${(rect.w / containerW) * 100}%`,
          height: `${(rect.h / containerH) * 100}%`,
          transform: rect.r ? `rotate(${rect.r}deg)` : undefined,
        }
      : {}

    return (
      <div
        key={`ctrl-${i}`}
        className={`pointer-events-none ${
          rect ? 'absolute' : (is4R ? 'h-full relative w-full' : 'flex-1 min-h-0 relative w-full')
        } ${isTrioHero ? 'col-span-2 row-span-1' : ''}`}
        style={customStyle}
      >
        {src && (
          <div className="absolute inset-x-1.5 top-1.5 flex items-center justify-between pointer-events-none">
            {/* Fit / Scale Badge — bisa diklik langsung atau double-tap foto */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                flipFit(i)
              }}
              className={`pointer-events-auto flex items-center rounded-full text-white backdrop-blur-md transition-all active:scale-95 shadow-md ${
                is4R || activeSlots >= 3 ? 'gap-1 px-2 py-0.5 text-[9px]' : 'gap-1.5 px-2.5 py-1 text-[11px]'
              }`}
              style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)' }}
              title="Klik atau ketuk 2x foto untuk ganti Fit Lebar / Fit Tinggi"
            >
              <span className="font-mono">{(tf.scale * 100).toFixed(0)}%</span>
              <span style={{ opacity: 0.35 }}>|</span>
              <span className="font-semibold tracking-wider">
                {tf.fit === 'width'
                  ? `↔ ${t('strip_fit_width') as string}`
                  : `↕ ${t('strip_fit_height') as string}`}
              </span>
              {tf.rotation > 0 && (
                <>
                  <span style={{ opacity: 0.35 }}>|</span>
                  <span>{tf.rotation}°</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  rotateSlot(i)
                }}
                className={`pointer-events-auto flex items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-95 ${
                  is4R || activeSlots >= 3 ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-xs'
                }`}
                style={{ background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.2)', lineHeight: 1 }}
                title="Putar 90°"
              >
                ⟳
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  clear(i)
                }}
                className={`pointer-events-auto flex items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-95 ${
                  is4R || activeSlots >= 3 ? 'h-6 w-6 text-xs' : 'h-7 w-7 text-sm'
                }`}
                style={{ background: 'rgba(220,38,38,0.85)', lineHeight: 1 }}
                title="Hapus foto dari slot"
              >
                ×
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const confirm = () => {
    if (printing || !isFull) return
    onConfirm(picked.slice(0, activeSlots).map((id, i) => ({ source: pool.find(p => p.id === id)!, transform: getTransform(i) })), mode)
  }

  if (!panel) return null

  return createPortal(
    <div
      className="absolute inset-0 z-[60] animate-fade-in"
      style={{ background: 'rgba(9,1,53,0.95)', backdropFilter: 'blur(20px)', borderRadius: 'inherit', overflow: 'clip' }}
    >
      <div className="screen-split screen-split--center flex flex-col w-full h-full">
        <div className="screen-title text-center px-5 pt-5 pb-4">
          <h1
            className="h1-glow"
            style={{ fontSize: 'clamp(28px,4.2vw,42px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}
          >
            {t(is4R ? 'strip_title_4r' : 'strip_title') as string}
          </h1>
          <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618 }}>
            {isFull ? (t('strip_hint_full') as string) : (t('strip_hint') as string)}
            {` · ${filled}/${activeSlots}`}
            {` · ${layoutName}`}
          </p>

          <div className="mt-4 flex items-center justify-center">
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(12px)', borderRadius: 10, padding: 3, gap: 3 }}>
              {([
                { key: '2R_STRIP', label: 'Layout', locked: false },
                { key: '4R_LANDSCAPE', label: '4R Postcard', locked: fourRLocked },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => handleModeSwitch(tab.key)}
                  disabled={printing || tab.locked}
                  aria-pressed={mode === tab.key}
                  style={{
                    padding: '6px 20px',
                    borderRadius: 7,
                    border: 'none',
                    cursor: tab.locked ? 'default' : 'pointer',
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: mode === tab.key ? 600 : 400,
                    background: mode === tab.key ? 'rgba(255,255,255,0.2)' : 'transparent',
                    color: mode === tab.key ? '#fff' : tab.locked ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.6)',
                    boxShadow: mode === tab.key ? '0 2px 8px rgba(0,0,0,0.25)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {tab.locked ? '🔒 ' : ''}{tab.label}
                </button>
              ))}
            </div>
          </div>
          {fourRLocked && (
            <p style={{ fontSize: 'var(--text-2xs)', color: '#ffcc66', marginTop: 8 }}>
              {t('strip_locked_4r') as string}
            </p>
          )}
        </div>

        <div className="screen-content">
          <div className="composer-stage flex-1 min-h-0 w-full flex items-center justify-center" style={{ padding: 4 }}>
            <div
              className="composer-paper relative overflow-hidden rounded-[12px]"
              style={{
                ['--paper-w' as string]: is4R ? (isPortrait4R ? 2 : 3) : 2,
                ['--paper-h' as string]: is4R ? (isPortrait4R ? 3 : 2) : 3,
                background: '#0a0a0a',
                boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
              }}
            >
              {is4R ? (
                /* ── 4R POSTCARD ── */
                <div className="relative h-full w-full">
                  {/* Layer 1: Slot Foto */}
                  {hasCustom4R ? (
                    <div className="relative h-full w-full">
                      {custom4rSlots!.slots.map((s, i) =>
                        renderSlot(i, 'single', s, isPortrait4R ? 1200 : 1800, isPortrait4R ? 1800 : 1200)
                      )}
                    </div>
                  ) : (
                    <div className={
                      isPortrait4R
                        ? ai4rLayout === 'SINGLE_1'
                          ? 'grid grid-cols-1 grid-rows-1 h-full w-full'
                          : ai4rLayout === 'GRID_3'
                          ? 'grid grid-cols-1 grid-rows-3 h-full w-full'
                          : ai4rLayout === 'SPLIT_2'
                          ? 'grid grid-cols-1 grid-rows-2 h-full w-full'
                          : 'grid grid-cols-2 grid-rows-2 h-full w-full'
                        : ai4rLayout === 'SINGLE_1'
                        ? 'grid grid-cols-1 grid-rows-1 h-full w-full'
                        : ai4rLayout === 'GRID_3'
                        ? 'grid grid-cols-3 grid-rows-1 h-full w-full'
                        : ai4rLayout === 'SPLIT_2'
                        ? 'grid grid-cols-2 grid-rows-1 h-full w-full'
                        : 'grid grid-cols-2 grid-rows-2 h-full w-full'
                    }>
                      {Array.from({ length: activeSlots }, (_, i) => renderSlot(i, 'single'))}
                    </div>
                  )}

                  {/* Layer 2: Overlay Frame 4R (z-20) */}
                  {overlay4rUrl && (
                    <img
                      src={overlay4rUrl}
                      alt="Overlay 4R"
                      className="absolute inset-0 z-20 h-full w-full object-cover pointer-events-none"
                    />
                  )}

                  {/* Layer 3: Kontrol Slot (z-30) */}
                  <div className="absolute inset-0 z-30 pointer-events-none">
                    {hasCustom4R ? (
                      <div className="relative h-full w-full pointer-events-none">
                        {custom4rSlots!.slots.map((s, i) =>
                          renderControls(i, s, isPortrait4R ? 1200 : 1800, isPortrait4R ? 1800 : 1200)
                        )}
                      </div>
                    ) : (
                      <div className={`pointer-events-none ${
                        isPortrait4R
                          ? ai4rLayout === 'SINGLE_1'
                            ? 'grid grid-cols-1 grid-rows-1 h-full w-full'
                            : ai4rLayout === 'GRID_3'
                            ? 'grid grid-cols-1 grid-rows-3 h-full w-full'
                            : ai4rLayout === 'SPLIT_2'
                            ? 'grid grid-cols-1 grid-rows-2 h-full w-full'
                            : 'grid grid-cols-2 grid-rows-2 h-full w-full'
                          : ai4rLayout === 'SINGLE_1'
                          ? 'grid grid-cols-1 grid-rows-1 h-full w-full'
                          : ai4rLayout === 'GRID_3'
                          ? 'grid grid-cols-3 grid-rows-1 h-full w-full'
                          : ai4rLayout === 'SPLIT_2'
                          ? 'grid grid-cols-2 grid-rows-1 h-full w-full'
                          : 'grid grid-cols-2 grid-rows-2 h-full w-full'
                      }`}>
                        {Array.from({ length: activeSlots }, (_, i) => renderControls(i))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* ── 2-STRIP FULL 4R SHEET (DUA STRIP BERDAMPINGAN) ── */
                <div className="relative h-full w-full">
                  {/* Layer 1: Slot Foto */}
                  <div className="grid grid-cols-2 h-full w-full relative z-10">
                    {/* Kolom Strip Kiri */}
                    <div className={`h-full w-full relative border-r border-dashed border-white/20 ${hasCustom2Strip ? '' : 'flex flex-col'}`}>
                      {hasCustom2Strip
                        ? customSlots!.slots.map((s, i) => renderSlot(i, 'left', s, 600, 1800))
                        : Array.from({ length: activeSlots }, (_, i) => renderSlot(i, 'left'))}
                      {(overlayRightUrl || isSingleStripOverlay) && overlayUrl && (
                        <img
                          src={overlayUrl}
                          alt="Strip Kiri"
                          className="absolute inset-0 z-20 h-full w-full object-cover pointer-events-none"
                        />
                      )}
                    </div>

                    {/* Kolom Strip Kanan */}
                    <div className={`h-full w-full relative ${hasCustom2Strip ? '' : 'flex flex-col'}`}>
                      {hasCustom2Strip
                        ? customSlots!.slots.map((s, i) => renderSlot(i, 'right', s, 600, 1800))
                        : Array.from({ length: activeSlots }, (_, i) => renderSlot(i, 'right'))}
                      {(overlayRightUrl || isSingleStripOverlay) && (
                        <img
                          src={(overlayRightUrl || overlayUrl) ?? undefined}
                          alt="Strip Kanan"
                          className="absolute inset-0 z-20 h-full w-full object-cover pointer-events-none"
                        />
                      )}
                    </div>
                  </div>

                  {/* Layer 2: Full Sheet Overlay */}
                  {!overlayRightUrl && !isSingleStripOverlay && overlayUrl && (
                    <img
                      src={overlayUrl}
                      alt="Overlay Full Sheet"
                      className="absolute inset-0 z-20 h-full w-full object-cover pointer-events-none"
                    />
                  )}

                  {/* Layer 3: Kontrol Slot (z-30) — khusus strip kiri (sisi interaktif) */}
                  <div className="absolute inset-0 z-30 pointer-events-none grid grid-cols-2 h-full w-full">
                    <div className={`h-full w-full relative pointer-events-none ${hasCustom2Strip ? '' : 'flex flex-col'}`}>
                      {hasCustom2Strip
                        ? customSlots!.slots.map((s, i) => renderControls(i, s, 600, 1800))
                        : Array.from({ length: activeSlots }, (_, i) => renderControls(i))}
                    </div>
                    <div className="h-full w-full pointer-events-none" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Kolam foto — sejajar frame chooser di PreviewScreen: baris kedua di dalam
              .screen-content, di bawah media, bukan kolom sendiri.
              SATU BARIS yang di-swipe, bukan wrap: 4 variasi AI + N foto asli gampang jadi
              8 kartu, dan versi wrap-nya makan tinggi berlapis-lapis sampai kanvasnya
              kegencet. `w-max mx-auto` = ketengah kalau sedikit, nge-scroll kalau banyak. */}
          <div
            ref={poolRef}
            onPointerDown={handlePoolDown}
            onPointerMove={handlePoolMove}
            onPointerUpCapture={handlePoolUpCapture}
            onPointerCancelCapture={handlePoolUpCapture}
            onPointerLeave={() => { poolDragRef.current = null }}
            className="strip-pool-scroll shrink-0 overflow-x-auto overflow-y-hidden px-2 pt-3 pb-1"
            style={{
              touchAction: 'pan-x',
              overscrollBehaviorX: 'contain',
              WebkitOverflowScrolling: 'touch',
              // Kabut di dua tepi = petunjuk "masih ada lagi ke samping". Scrollbar-nya
              // disembunyiin, jadi tanpa ini kolam yang kepanjangan kelihatan kayak udah abis.
              maskImage: 'linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent)',
              WebkitMaskImage: 'linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent)',
            }}
          >
            <div className="flex w-max mx-auto gap-2.5 items-center px-1">
              {pool.map(src => {
                const at = slotOf(src.id)
                const used = at >= 0
                return (
                  <button
                    key={src.id}
                    type="button"
                    // Kartu kepilih ditekan lagi = KELUAR dari slotnya. Dulu dia di-disable,
                    // jadi satu-satunya jalan batal cuma × di artboard — dan pas strip udah
                    // penuh, SEMUA kartu mati sekaligus: tamu ga bisa nuker pilihan, cuma
                    // bisa mundur ke artboard. Kartu ini yang dia tunjuk, di sini juga
                    // batalnya.
                    onClick={() => (used ? clear(at) : fill(src.id))}
                    disabled={(!used && isFull) || printing}
                    aria-pressed={used}
                    title={used ? (t('strip_slot_clear') as string) : undefined}
                    // draggable=false: browser bawaannya nge-drag <img> jadi ghost image,
                    // dan itu ngebajak seretan sebelum shim scroll sempat jalan.
                    draggable={false}
                    className="relative flex-none overflow-hidden rounded-[10px] transition-transform duration-200 active:scale-[0.96]"
                    style={{
                      width: 110,
                      maxWidth: 110,
                      aspectRatio: '3 / 4',
                      border: used ? '2px solid var(--brand)' : '1px solid rgba(255,255,255,0.14)',
                      // Kepilih = redup TAPI jangan seredup yang mati. Dulu 0.4 sama-sama
                      // dipakai buat "udah dipakai" dan bacaan "ga bisa diapa-apain";
                      // sekarang dia bisa ditekan, jadi harus kelihatan hidup.
                      opacity: used ? 0.75 : isFull ? 0.4 : 1,
                      cursor: !used && isFull ? 'default' : 'pointer',
                    }}
                  >
                    <img src={src.thumbUrl} alt="" draggable={false} className="h-full w-full object-cover pointer-events-none" />
                    {used && (
                      <span
                        className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full shadow-md"
                        style={{ background: 'var(--brand)', color: 'var(--brand-fg)', fontSize: 'var(--text-2xs)', fontWeight: 700 }}
                      >
                        {at + 1}
                      </span>
                    )}
                    <span
                      className="absolute inset-x-0 bottom-0 py-0.5 text-center font-medium"
                      style={{ background: 'rgba(9,1,53,0.85)', fontSize: '9px', color: 'var(--fg)' }}
                    >
                      {src.kind === 'original' ? (t('strip_label_original') as string) : (t('strip_label_ai') as string)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

        </div>

        <div className="screen-actions shrink-0 p-5">
          <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-subtle)', margin: '0 0 8px', textAlign: 'center' }}>
            💡 {t('strip_tip') as string}
          </p>
          {error && (
            <p role="alert" style={{ fontSize: 'var(--text-xs)', color: '#ff8a8a', margin: '0 0 8px', textAlign: 'center' }}>
              {t('strip_print_failed') as string}
            </p>
          )}
          {/* Dua tombol lebar sama + panah, persis kayak nav "← Previous | Next →" di screen
              lain: secondary buat mundur, primary buat maju. Ungu solid var(--brand) dicabut
              — di seluruh kiosk ga ada satu pun tombol aksi yang diisi warna penuh, jadi yang
              di sini kelihatan kayak komponen dari aplikasi lain. */}
          <div className="flex gap-3">
            <TouchButton variant="secondary" onClick={onCancel} disabled={printing} className="flex-1">
              {t('nav_back') as string}
            </TouchButton>
            <TouchButton
              onClick={confirm}
              disabled={!isFull || printing}
              className="flex-1"
            >
              {printing
                ? (t('preview_printing') as string)
                : `${t(is4R ? 'strip_print_4r' : 'strip_print_btn') as string} →`}
            </TouchButton>
          </div>
        </div>
      </div>
    </div>,
    panel,
  )
}

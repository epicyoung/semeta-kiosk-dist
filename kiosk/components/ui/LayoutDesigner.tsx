'use client'
import { useState, useEffect, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import Moveable from 'react-moveable'
import type { Template, PrintSize } from '@/lib/types'
import { CANVAS_4R_PORTRAIT, CANVAS_4R_LANDSCAPE, PANEL_2R_STRIP } from '@/lib/print-layout'

type Slot = { x: number; y: number; w: number; h: number; r?: number }
type Props = {
  template: Template
  onSave: (layoutConfig: { slots: Slot[] }) => void
  onClose: () => void
}

// Studio bench palette — derived from the kiosk design tokens (surface #090135, brand #7c3aed).
// This screen is operator-only, so contrast + touch targets win over decoration.
const SURFACE = '#090135'
const BRAND = '#7c3aed'
const GLASS = 'rgba(255,255,255,0.06)'
const GLASS_LINE = 'rgba(255,255,255,0.12)'
const FG = '#ffffff'
const FG_MUTED = 'rgba(255,255,255,0.6)'

const SIZE_LABEL: Record<PrintSize, string> = {
  '4R_PORTRAIT': '4R Portrait',
  '4R_LANDSCAPE': '4R Landscape',
  '2R_STRIP': '2R Strip',
}

export function LayoutDesigner({ template, onSave, onClose }: Props) {
  const [slots, setSlots] = useState<Slot[]>(template.layout_config?.slots || [])
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null)
  const [target, setTarget] = useState<HTMLElement | null>(null)

  const size: PrintSize = template.print_size || '4R_PORTRAIT'
  const canvasDims = size === '4R_LANDSCAPE' ? CANVAS_4R_LANDSCAPE :
                     size === '2R_STRIP' ? PANEL_2R_STRIP :
                     CANVAS_4R_PORTRAIT

  const [scale, setScale] = useState(500 / canvasDims.h)
  const displayW = canvasDims.w * scale
  const displayH = canvasDims.h * scale

  useEffect(() => {
    // Fit the paper to the viewport, leaving room for header + toolbar chrome.
    const calculateScale = () => {
      const availableHeight = window.innerHeight - 260
      const availableWidth = window.innerWidth - 120
      setScale(Math.min(availableHeight / canvasDims.h, availableWidth / canvasDims.w))
    }
    calculateScale()
    window.addEventListener('resize', calculateScale)
    return () => window.removeEventListener('resize', calculateScale)
  }, [canvasDims.w, canvasDims.h])

  const generateDefaultSlots = (): Slot[] => {
    const out: Slot[] = []
    const n = template.shot_count || 4
    const w = 600
    const h = 400
    const gap = 30
    const totalH = (n * h) + ((n - 1) * gap)
    const startY = Math.max(50, (canvasDims.h - totalH) / 2)
    const startX = (canvasDims.w - w) / 2
    for (let i = 0; i < n; i++) {
      out.push({ x: startX, y: startY + (i * (h + gap)), w, h, r: 0 })
    }
    return out
  }

  useEffect(() => {
    if (slots.length === 0) setSlots(generateDefaultSlots())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAddSlot = () => setSlots([...slots, { x: 50, y: 50, w: 600, h: 400, r: 0 }])

  const handleDeleteSlot = () => {
    if (selectedSlotIndex === null) return
    setSlots(slots.filter((_, i) => i !== selectedSlotIndex))
    setSelectedSlotIndex(null)
    setTarget(null)
  }

  const handleReset = () => {
    setSlots(generateDefaultSlots())
    setSelectedSlotIndex(null)
    setTarget(null)
  }

  const clearSelection = () => {
    setSelectedSlotIndex(null)
    setTarget(null)
  }

  const updateSlot = (index: number, updates: Partial<Slot>) => {
    const next = [...slots]
    next[index] = { ...next[index], ...updates }
    setSlots(next)
  }

  // ── styles ──────────────────────────────────────────────────────────────
  const pillBtn = (accent: boolean, danger = false, dim = false): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8,
    height: 52, padding: '0 20px',
    borderRadius: 999,
    fontSize: 15, fontWeight: 600, letterSpacing: '0.01em',
    cursor: dim ? 'default' : 'pointer',
    opacity: dim ? 0.4 : 1,
    color: danger ? '#ff9d9d' : FG,
    background: accent ? BRAND : GLASS,
    border: `1px solid ${accent ? 'transparent' : danger ? 'rgba(255,120,120,0.35)' : GLASS_LINE}`,
    boxShadow: accent ? `0 8px 24px -8px ${BRAND}` : 'none',
    transition: 'background 140ms ease, opacity 140ms ease',
    WebkitTapHighlightColor: 'transparent',
  })

  const content = (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', flexDirection: 'column',
      color: FG,
      background: `radial-gradient(120% 90% at 50% -10%, #150a4a 0%, ${SURFACE} 55%, #05001f 100%)`,
    }}>
      {/* faint dot grid — reads as a studio bench surface, not a void */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5,
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)',
        backgroundSize: '26px 26px',
      }} />

      {/* Header */}
      <header style={{
        position: 'relative', zIndex: 1,
        padding: '20px 28px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: `1px solid ${GLASS_LINE}`,
        background: 'rgba(9,1,53,0.4)', backdropFilter: 'blur(12px)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, letterSpacing: '0.28em', textTransform: 'uppercase', color: BRAND, fontWeight: 700 }}>
            Layout Studio
          </span>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>
            {template.name}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={onClose} style={pillBtn(false)}>Cancel</button>
          <button onClick={() => onSave({ slots })} style={pillBtn(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Save Layout
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <div style={{
        position: 'relative', zIndex: 1,
        padding: '16px 28px',
        display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
      }}>
        <button onClick={handleAddSlot} style={pillBtn(false)}>
          <span style={{ fontSize: 20, lineHeight: 0, marginTop: -2, color: BRAND }}>+</span>
          Add Slot
        </button>
        <button onClick={handleDeleteSlot} disabled={selectedSlotIndex === null} style={pillBtn(false, true, selectedSlotIndex === null)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          Delete
        </button>
        <button onClick={handleReset} style={pillBtn(false)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Reset
        </button>

        <span style={{ width: 1, height: 28, background: GLASS_LINE, margin: '0 4px' }} />

        {/* Live paper spec — the real print dimensions, always visible */}
        <span style={{
          display: 'flex', alignItems: 'center', gap: 10,
          height: 52, padding: '0 18px', borderRadius: 999,
          background: 'rgba(0,0,0,0.25)', border: `1px solid ${GLASS_LINE}`,
          fontSize: 13, color: FG_MUTED, fontVariantNumeric: 'tabular-nums',
        }}>
          <strong style={{ color: FG, fontWeight: 600 }}>{SIZE_LABEL[size]}</strong>
          {canvasDims.w} × {canvasDims.h} px
          <span style={{ color: 'rgba(255,255,255,0.35)' }}>· {slots.length} slot{slots.length === 1 ? '' : 's'}</span>
        </span>
      </div>

      {/* Canvas stage */}
      <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 24 }}>
        <div style={{ position: 'relative' }}>
          {/* Paper — the signature: a physical print sitting on the bench */}
          <div
            style={{
              width: displayW, height: displayH,
              position: 'relative',
              background: template.overlay_url ? '#1a1140' : '#f4f2ec',
              backgroundImage: template.overlay_url ? `url(${template.overlay_url})` : 'none',
              backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
              borderRadius: 4,
              boxShadow: '0 40px 80px -24px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08)',
              outline: `1px solid ${GLASS_LINE}`,
              outlineOffset: 8,
            }}
            onClick={(e) => { if (e.target === e.currentTarget) clearSelection() }}
          >
            {slots.map((slot, i) => {
              const isSelected = selectedSlotIndex === i
              return (
                <div
                  key={i}
                  className={`slot-target-${i}`}
                  onClick={() => {
                    setSelectedSlotIndex(i)
                    setTarget(document.querySelector(`.slot-target-${i}`) as HTMLElement)
                  }}
                  style={{
                    position: 'absolute', left: 0, top: 0,
                    width: slot.w * scale, height: slot.h * scale,
                    transform: `translate(${slot.x * scale}px, ${slot.y * scale}px) rotate(${slot.r || 0}deg)`,
                    background: isSelected ? 'rgba(124,58,237,0.28)' : 'rgba(9,1,53,0.32)',
                    border: isSelected ? `2px solid ${BRAND}` : '2px dashed rgba(255,255,255,0.55)',
                    boxShadow: isSelected ? `0 0 0 4px rgba(124,58,237,0.25), 0 12px 30px -12px ${BRAND}` : 'none',
                    boxSizing: 'border-box',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                    color: FG,
                    zIndex: isSelected ? 10 : 1,
                    cursor: 'pointer',
                    transition: 'background 120ms ease, box-shadow 120ms ease',
                  }}
                >
                  <span style={{ fontSize: 11, letterSpacing: '0.18em', color: isSelected ? '#d9c9ff' : 'rgba(255,255,255,0.7)', fontWeight: 700 }}>SHOT</span>
                  <span style={{ fontSize: Math.max(22, slot.h * scale * 0.28), fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
              )
            })}

            {slots.length === 0 && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center', padding: 24,
                color: template.overlay_url ? 'rgba(255,255,255,0.8)' : 'rgba(9,1,53,0.6)',
              }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>No photo slots yet</span>
                <span style={{ fontSize: 13, opacity: 0.75 }}>Add a slot or reset to the default grid.</span>
              </div>
            )}

            {target && selectedSlotIndex !== null && (
              <Moveable
                target={target}
                draggable resizable keepRatio rotatable snappable
                bounds={{ left: 0, top: 0, right: displayW, bottom: displayH }}
                onDrag={e => { e.target.style.transform = e.transform }}
                onDragEnd={e => {
                  const match = e.target.style.transform.match(/translate\(([^px]+)px,\s*([^px]+)px\)/)
                  if (match) updateSlot(selectedSlotIndex, { x: parseFloat(match[1]) / scale, y: parseFloat(match[2]) / scale })
                }}
                onResize={e => {
                  e.target.style.width = `${e.width}px`
                  e.target.style.height = `${e.height}px`
                  e.target.style.transform = e.drag.transform
                }}
                onResizeEnd={e => {
                  const el = e.target as HTMLElement
                  const match = el.style.transform.match(/translate\(([^px]+)px,\s*([^px]+)px\)/)
                  const upd: Partial<Slot> = { w: parseFloat(el.style.width) / scale, h: parseFloat(el.style.height) / scale }
                  if (match) { upd.x = parseFloat(match[1]) / scale; upd.y = parseFloat(match[2]) / scale }
                  updateSlot(selectedSlotIndex, upd)
                }}
                onRotate={e => { e.target.style.transform = e.drag.transform }}
                onRotateEnd={e => {
                  const match = e.target.style.transform.match(/rotate\(([^deg]+)deg\)/)
                  if (match) updateSlot(selectedSlotIndex, { r: parseFloat(match[1]) })
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Hint bar */}
      <footer style={{
        position: 'relative', zIndex: 1,
        padding: '14px 28px', textAlign: 'center',
        fontSize: 13, color: FG_MUTED,
        borderTop: `1px solid ${GLASS_LINE}`,
        background: 'rgba(9,1,53,0.4)', backdropFilter: 'blur(12px)',
      }}>
        Tap a slot to select · drag to move · corner handles resize · slot order = shot order
      </footer>
    </div>
  )

  if (typeof document !== 'undefined') return createPortal(content, document.body)
  return content
}

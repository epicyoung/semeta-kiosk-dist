'use client'
import { useState, useEffect, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import Moveable from 'react-moveable'
import type { Template, PrintSize } from '@/lib/types'
import { CANVAS_4R_PORTRAIT, CANVAS_4R_LANDSCAPE, PANEL_2R_STRIP, layoutSlots } from '@/lib/print-layout'

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
  '2R_STRIP': '2 Stripe',
}

export function LayoutDesigner({ template, onSave, onClose }: Props) {
  const [slots, setSlots] = useState<Slot[]>(template.layout_config?.slots || [])
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null)
  const [target, setTarget] = useState<HTMLElement | null>(null)

  const size: PrintSize = template.print_size || '4R_PORTRAIT'
  const is2Stripe = size === '2R_STRIP'

  // 2 Stripe: edit on the LEFT panel (600×1800) but DISPLAY the full 4R sheet (1200×1800)
  // with a center dividing line and right side mirrored. Slots saved relative to panel (600w).
  const editDims = is2Stripe ? PANEL_2R_STRIP :
                   size === '4R_LANDSCAPE' ? CANVAS_4R_LANDSCAPE :
                   CANVAS_4R_PORTRAIT
  // Display: 2 Stripe shows full 4R sheet
  const displayDims = is2Stripe ? CANVAS_4R_PORTRAIT :
                      size === '4R_LANDSCAPE' ? CANVAS_4R_LANDSCAPE :
                      CANVAS_4R_PORTRAIT

  const [scale, setScale] = useState(500 / displayDims.h)
  const displayW = displayDims.w * scale
  const displayH = displayDims.h * scale
  // Panel width for the editable left half (2 Stripe only)
  const panelW = is2Stripe ? editDims.w * scale : displayW

  useEffect(() => {
    // Fit the paper to the viewport, leaving room for header + toolbar chrome.
    const calculateScale = () => {
      const availableHeight = window.innerHeight - 260
      const availableWidth = window.innerWidth - 120
      setScale(Math.min(availableHeight / displayDims.h, availableWidth / displayDims.w))
    }
    calculateScale()
    window.addEventListener('resize', calculateScale)
    return () => window.removeEventListener('resize', calculateScale)
  }, [displayDims.w, displayDims.h])

  const generateDefaultSlots = (): Slot[] => {
    const n = template.shot_count || 4
    const { slots: defaultGrid } = layoutSlots(size, n)
    
    // Beri sedikit padding/gap (shrink 4%) biar gampang di-resize (gak nempel tembok)
    return defaultGrid.map(s => {
      const padW = s.w * 0.04
      const padH = s.h * 0.04
      return {
        x: s.x + padW,
        y: s.y + padH,
        w: s.w - (padW * 2),
        h: s.h - (padH * 2),
        r: s.r || 0
      }
    })
  }

  useEffect(() => {
    if (slots.length === 0) setSlots(generateDefaultSlots())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAddSlot = () => setSlots([...slots, { x: 50, y: 50, w: Math.min(editDims.w - 100, 500), h: 350, r: 0 }])

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

  // Mirror a slot from left panel to right panel (2 Stripe only)
  const mirrorSlot = (slot: Slot): Slot => ({
    ...slot,
    x: editDims.w + (editDims.w - slot.x - slot.w), // mirror x position
    r: slot.r ? -slot.r : 0, // mirror rotation
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
          {editDims.w} × {editDims.h} px
          <span style={{ color: 'rgba(255,255,255,0.35)' }}>· {slots.length} slot{slots.length === 1 ? '' : 's'}</span>
          {is2Stripe && (
            <span style={{ color: 'rgba(124,58,237,0.8)', fontWeight: 600 }}>· mirrored 2-up</span>
          )}
        </span>
      </div>

      {/* Canvas stage */}
      <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 24 }}>
        <div style={{ position: 'relative' }}>
          {/* Paper — the full display sheet */}
          <div
            style={{
              width: displayW, height: displayH,
              position: 'relative',
              background: template.overlay_url ? '#1a1140' : '#272729',
              borderRadius: 4,
              boxShadow: '0 40px 80px -24px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08)',
              outline: `1px solid ${GLASS_LINE}`,
              outlineOffset: 8,
              overflow: 'hidden',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) clearSelection() }}
          >
            {/* LEFT panel overlay (or full overlay for 4R) */}
            {template.overlay_url && (
              <div style={{
                position: 'absolute',
                left: 0, top: 0,
                width: panelW, height: displayH,
                backgroundImage: `url(${template.overlay_url})`,
                backgroundSize: is2Stripe ? `${panelW}px ${displayH}px` : 'contain',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
                pointerEvents: 'none', zIndex: 5,
              }} />
            )}

            {/* RIGHT panel overlay mirror (2 Stripe only) */}
            {is2Stripe && template.overlay_url && (
              <div style={{
                position: 'absolute',
                left: panelW, top: 0,
                width: panelW, height: displayH,
                backgroundImage: `url(${template.overlay_url})`,
                backgroundSize: `${panelW}px ${displayH}px`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
                pointerEvents: 'none', zIndex: 5,
                opacity: 0.45,
              }} />
            )}

            {/* ── Editable slots (left panel for 2 Stripe, full canvas for 4R) ── */}
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

            {/* ── Mirrored ghost slots (2 Stripe right panel) ─────────── */}
            {is2Stripe && slots.map((slot, i) => {
              const m = mirrorSlot(slot)
              return (
                <div
                  key={`mirror-${i}`}
                  style={{
                    position: 'absolute', left: 0, top: 0,
                    width: m.w * scale, height: m.h * scale,
                    transform: `translate(${(m.x + editDims.w) * scale}px, ${m.y * scale}px) rotate(${m.r || 0}deg)`,
                    background: 'rgba(124,58,237,0.08)',
                    border: '2px dashed rgba(124,58,237,0.3)',
                    boxSizing: 'border-box',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                    color: 'rgba(124,58,237,0.5)',
                    pointerEvents: 'none',
                  }}
                >
                  <span style={{ fontSize: 9, letterSpacing: '0.15em', fontWeight: 700 }}>MIRROR</span>
                  <span style={{ fontSize: Math.max(16, m.h * scale * 0.22), fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
              )
            })}

            {/* ── Center divider line (2 Stripe only) ────────────────── */}
            {is2Stripe && (
              <>
                <div style={{
                  position: 'absolute', left: panelW - 1, top: 0,
                  width: 2, height: displayH,
                  background: 'rgba(255,255,255,0.35)',
                  zIndex: 20, pointerEvents: 'none',
                }} />
                {/* Cut line label */}
                <div style={{
                  position: 'absolute', left: panelW - 28, top: 8,
                  background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                  borderRadius: 4, padding: '2px 6px',
                  fontSize: 8, letterSpacing: '0.15em', textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.6)', fontWeight: 700,
                  zIndex: 21, pointerEvents: 'none', whiteSpace: 'nowrap',
                }}>
                  ✂ cut
                </div>
                {/* Left panel label */}
                <div style={{
                  position: 'absolute', left: 6, bottom: 6,
                  fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.4)', fontWeight: 700,
                  zIndex: 21, pointerEvents: 'none',
                }}>
                  ← edit this side
                </div>
                {/* Right panel label */}
                <div style={{
                  position: 'absolute', right: 6, bottom: 6,
                  fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: 'rgba(124,58,237,0.5)', fontWeight: 700,
                  zIndex: 21, pointerEvents: 'none',
                }}>
                  auto-mirror →
                </div>
              </>
            )}

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
                bounds={{ left: 0, top: 0, right: is2Stripe ? panelW : displayW, bottom: displayH }}
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
        {is2Stripe
          ? 'Edit the LEFT panel only — right side auto-mirrors · cut line marks the fold'
          : 'Tap a slot to select · drag to move · corner handles resize · slot order = shot order'}
      </footer>
    </div>
  )

  if (typeof document !== 'undefined') return createPortal(content, document.body)
  return content
}

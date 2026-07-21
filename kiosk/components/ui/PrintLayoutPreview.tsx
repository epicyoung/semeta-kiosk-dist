import React from 'react'
import type { Template } from '@/lib/types'
import { layoutSlots, CANVAS_4R_PORTRAIT, PANEL_2R_STRIP } from '@/lib/print-layout'

type Props = {
  template: Template
  shots: string[]
  containerWidth?: number
  containerHeight?: number
}

export function PrintLayoutPreview({ template, shots, containerWidth, containerHeight }: Props) {
  const size = template.print_size || '4R_PORTRAIT'
  const overlayUrl = template.overlay_url
  const is2Stripe = size === '2R_STRIP'
  
  // This layout logic strictly matches lib/print-layout.ts
  const { canvas, slots } = layoutSlots(size, shots.length, template.layout_config)

  // 2R_STRIP: show the 2-up view (full 4R sheet, 1200×1800) so it naturally
  // fits a 2:3 container. Left + right panels are identical (mirrored).
  const displayCanvas = is2Stripe ? CANVAS_4R_PORTRAIT : canvas
  
  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden'
    }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          maxWidth: containerWidth ? 'none' : '100%',
          maxHeight: containerHeight ? 'none' : '100%',
          aspectRatio: `${displayCanvas.w} / ${displayCanvas.h}`,
          background: '#272729', // dark grey, matches Layout Studio
          borderRadius: 3,
          boxShadow: '0 24px 48px -16px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1)',
          overflow: 'hidden'
        }}
      >
        {/* ── Render panels (2 Stripe = left + right mirror, 4R = single) ── */}
        {is2Stripe ? (
          <>
            {/* LEFT panel */}
            <StripPanel
              slots={slots} shots={shots} canvas={canvas}
              overlayUrl={overlayUrl}
              style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%' }}
            />
            {/* RIGHT panel (mirror) */}
            <StripPanel
              slots={slots} shots={shots} canvas={canvas}
              overlayUrl={overlayUrl}
              style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '100%' }}
            />
            {/* Center dividing line */}
            <div style={{
              position: 'absolute', left: '50%', top: 0,
              width: 1, height: '100%',
              background: 'rgba(0,0,0,0.15)',
              transform: 'translateX(-0.5px)',
              zIndex: 10, pointerEvents: 'none',
            }} />
          </>
        ) : (
          <>
            {/* Render Shots */}
            {slots.map((slot, i) => {
              const shotUrl = shots[i]
              if (!shotUrl) return null
              const pX = (slot.x / canvas.w) * 100
              const pY = (slot.y / canvas.h) * 100
              const pW = (slot.w / canvas.w) * 100
              const pH = (slot.h / canvas.h) * 100
              return (
                <div 
                  key={i}
                  style={{
                    position: 'absolute',
                    left: `${pX}%`,
                    top: `${pY}%`,
                    width: `${pW}%`,
                    height: `${pH}%`,
                    transform: `rotate(${slot.r || 0}deg)`,
                    transformOrigin: 'center',
                    overflow: 'hidden'
                  }}
                >
                  <img 
                    src={shotUrl} 
                    alt={`shot ${i+1}`} 
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                  />
                </div>
              )
            })}
            {/* Render Overlay */}
            {overlayUrl && (
              <img 
                src={overlayUrl} 
                alt="overlay" 
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  pointerEvents: 'none'
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// A single 2R strip panel — used for both left and right (mirror) in the 2-up view
function StripPanel({ slots, shots, canvas, overlayUrl, style }: {
  slots: { x: number; y: number; w: number; h: number; r?: number }[]
  shots: string[]
  canvas: { w: number; h: number }
  overlayUrl?: string | null
  style: React.CSSProperties
}) {
  return (
    <div style={{ ...style, overflow: 'hidden', position: 'absolute' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {slots.map((slot, i) => {
          const shotUrl = shots[i]
          if (!shotUrl) return null
          const pX = (slot.x / canvas.w) * 100
          const pY = (slot.y / canvas.h) * 100
          const pW = (slot.w / canvas.w) * 100
          const pH = (slot.h / canvas.h) * 100
          return (
            <div 
              key={i}
              style={{
                position: 'absolute',
                left: `${pX}%`,
                top: `${pY}%`,
                width: `${pW}%`,
                height: `${pH}%`,
                transform: `rotate(${slot.r || 0}deg)`,
                transformOrigin: 'center',
                overflow: 'hidden'
              }}
            >
              <img 
                src={shotUrl} 
                alt={`shot ${i+1}`} 
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />
            </div>
          )
        })}
        {overlayUrl && (
          <img 
            src={overlayUrl} 
            alt="overlay" 
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              pointerEvents: 'none'
            }}
          />
        )}
      </div>
    </div>
  )
}

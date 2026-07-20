import React from 'react'
import type { Template } from '@/lib/types'
import { layoutSlots } from '@/lib/print-layout'

type Props = {
  template: Template
  shots: string[]
  containerWidth?: number
  containerHeight?: number
}

export function PrintLayoutPreview({ template, shots, containerWidth, containerHeight }: Props) {
  const size = template.print_size || '4R_PORTRAIT'
  const overlayUrl = template.overlay_url
  
  // This layout logic strictly matches lib/print-layout.ts
  const { canvas, slots } = layoutSlots(size, shots.length, template.layout_config)

  // Determine scaling to fit exactly within the container
  // If no container dimensions are provided, we fill parent (100% width/height)
  // But we must preserve the aspect ratio of the canvas!
  
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
          aspectRatio: `${canvas.w} / ${canvas.h}`,
          background: '#f4f2ec', // warm paper white, matches Layout Studio
          borderRadius: 3,
          boxShadow: '0 24px 48px -16px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1)',
          overflow: 'hidden'
        }}
      >
        {/* Render Shots */}
        {slots.map((slot, i) => {
          const shotUrl = shots[i]
          if (!shotUrl) return null
          
          // CSS percent mapping to map canvas coordinates to relative percentages
          // so it scales perfectly regardless of the container size
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
                  objectFit: 'cover' // matches the coverFit() logic in print-layout.ts
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
              pointerEvents: 'none' // allow clicks to pass through if necessary
            }}
          />
        )}
      </div>
    </div>
  )
}

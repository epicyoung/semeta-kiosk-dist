'use client'
import { type Dispatch } from 'react'
import { TouchButton } from '@/components/ui/TouchButton'
import type { KioskAction } from '@/lib/types'
import { useT } from '@/lib/i18n'

const CATEGORIES = [
  { id: 'faceswap', label: 'FACESWAP',    img: '/sample%20(1).jpg' },
  { id: 'fullbody', label: 'FULLBODY',    img: '/sample%20(2).jpg' },
  { id: 'original', label: 'ORIGINAL',    img: '/sample%20(3).jpg' },
  { id: 'nano',     label: 'NANO BANANA', img: '/sample%20(4).jpg' },
  { id: 'gptimg',  label: 'GPTIMG2',     img: '/sample%20(5).jpg' },
]

export function IdleScreen({ dispatch }: { dispatch: Dispatch<KioskAction> }) {
  const t = useT()
  return (
    <div className="screen-split screen-split--lowtitle flex flex-col w-full h-full overflow-hidden">
      {/* H1/H2 */}
      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1 className="h1-glow" style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>
          {t('idle_title') as string}
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618, whiteSpace: 'pre-line' }}>
          {t('idle_subtitle') as string}
        </p>
      </div>

      {/* Cards */}
      <div className="screen-content">
        <div className="flex-1 min-h-0 flex items-center justify-center px-5 pb-2">
          <div className="idle-menu-grid">
            {CATEGORIES.map((cat, i) => (
              <div
                key={cat.id}
                className={`idle-menu-box idle-menu-box-${i + 1}`}
                data-text={cat.label}
              >
                <img src={cat.img} alt={cat.label} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Button */}
      <div className="screen-actions shrink-0 p-5">
        <TouchButton className="w-full" onClick={() => dispatch({ type: 'START' })}>
          {t('idle_next') as string}
        </TouchButton>
        {/* Legal gate for Magic Catcher — must render before reaction cam may record. */}
        <p style={{ marginTop: 12, fontSize: 'var(--text-2xs)', lineHeight: 1.5, textAlign: 'center', color: 'rgba(255,255,255,0.6)', maxWidth: 520, marginInline: 'auto', fontFamily: 'var(--font-ui)' }}>
          {t('legal_recording_notice') as string}
        </p>
      </div>
    </div>
  )
}


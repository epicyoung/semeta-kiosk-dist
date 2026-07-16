'use client'
import { type Dispatch } from 'react'
import type { KioskAction, KioskState } from '@/lib/types'
import { useT } from '@/lib/i18n'

type Props = {
  state: Extract<KioskState, { screen: 'resultchooser' }>
  dispatch: Dispatch<KioskAction>
}

// VIP multi-template: N hasil AI di grid, tamu ketuk 1 → PICK_RESULT collapse ke framechooser.
// 2 → 1x2, 3 → 2 kolom (baris auto), 4 → 2x2. Selalu 2 kolom biar konsisten & besar di touch.
export function ResultChooserScreen({ state, dispatch }: Props) {
  const t = useT()
  const n = state.results.length
  const cols = n <= 1 ? 1 : 2

  return (
    <div className="screen-split flex flex-col w-full h-full overflow-hidden">
      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1
          className="h1-glow"
          style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}
        >
          {t('resultchooser_title') as string}
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618 }}>
          {t('resultchooser_subtitle') as string}
        </p>
      </div>

      <div className="screen-content">
        <div className="flex-1 min-h-0 overflow-y-auto px-5 flex items-center justify-center">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16, maxWidth: 560, width: '100%', paddingBottom: 24 }}>
            {state.results.map((r, i) => (
              <button
                key={r.templateId + i}
                onClick={() => dispatch({ type: 'PICK_RESULT', result: r })}
                className="relative overflow-hidden active:scale-[0.97] transition-all duration-200"
                style={{ borderRadius: 'var(--radius-btn)', border: '2px solid rgba(255,255,255,0.15)', boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.2)' }}
              >
                <div className="w-full aspect-[2/3] relative overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <img src={r.aiUrl} alt={`result ${i + 1}`} className="absolute inset-0 w-full h-full object-cover" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

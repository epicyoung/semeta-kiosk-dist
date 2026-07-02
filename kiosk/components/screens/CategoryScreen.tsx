'use client'
import { useState, type Dispatch } from 'react'
import { TouchButton } from '@/components/ui/TouchButton'
import { PinBadge } from '@/components/ui/PinBadge'
import type { KioskAction, KioskState, Template } from '@/lib/types'
import { useT } from '@/lib/i18n'
import { EPICPIN_TEMPLATE } from '@/lib/epicpin'

type Props = {
  state: Extract<KioskState, { screen: 'category' }>
  dispatch: Dispatch<KioskAction>
  templates: Template[]
}

const skipToPreview = (imageUrl: string, dispatch: Dispatch<KioskAction>) =>
  dispatch({ type: 'SHOW_PREVIEW', aiUrl: imageUrl, originalUrl: imageUrl })

export function CategoryScreen({ state, dispatch, templates }: Props) {
  const t = useT()
  const [selected, setSelected] = useState<string | null>(null)

  const categories = [...new Set(templates.map(tmpl => tmpl.category))]

  return (
    <div className="screen-split flex flex-col w-full h-full overflow-hidden">
      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1 className="h1-glow" style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>
          {t('category_title') as string}
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618, whiteSpace: 'pre-line' }}>
          {t('category_subtitle') as string}
        </p>
      </div>

      <div className="screen-content">
        <div className="flex-1 min-h-0 px-5 pb-2 overflow-y-auto">
          {categories.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--text-sm)', letterSpacing: '0.05em' }}>{t('category_empty') as string}</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelected(cat)}
                  className="glass-btn active:scale-[0.97] transition-transform h-[72px]"
                  style={{
                    background: selected === cat ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
                    color: selected === cat ? '#fff' : 'rgba(255,255,255,0.7)',
                    fontSize: 'var(--text-sm)', fontWeight: 400, letterSpacing: '0.05em',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  {cat === EPICPIN_TEMPLATE.category && <PinBadge size={14} color="currentColor" style={{ flexShrink: 0 }} />}
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <div className="screen-actions shrink-0 p-5 flex gap-3">
        <TouchButton variant="secondary" onClick={() => dispatch({ type: 'BACK' })} className="flex-1">
          {t('nav_back') as string}
        </TouchButton>
        <TouchButton variant="secondary" onClick={() => skipToPreview(state.imageUrl, dispatch)} className="flex-1">
          {t('category_skip') as string}
        </TouchButton>
        <TouchButton
          onClick={() => selected && dispatch({ type: 'SELECT_CATEGORY', category: selected })}
          disabled={!selected}
          className="flex-1"
        >
          {t('nav_next') as string}
        </TouchButton>
      </div>
    </div>
  )
}


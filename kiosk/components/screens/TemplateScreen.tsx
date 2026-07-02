'use client'
import { type Dispatch } from 'react'
import { TouchButton } from '@/components/ui/TouchButton'
import { PinBadge } from '@/components/ui/PinBadge'
import type { KioskAction, KioskState, Template } from '@/lib/types'
import { useT } from '@/lib/i18n'
import { SPINDONESIA_CATEGORY } from '@/lib/spindonesia-category'

const DUMMY_TEMPLATES: Template[] = Array.from({ length: 20 }, (_, i) => ({
  id: `d${i + 1}`, name: `Template ${i + 1}`, category: 'faceswap', token_cost: 1, thumbnail_url: null,
  gender_filter: 'ALL' as const, engine_type: 'faceswap' as const,
  positive_prompt: null, negative_prompt: null, api_endpoint: null,
  video_endpoint: null, video_positive_prompt: null, video_negative_prompt: null,
}))

type Props = {
  state: Extract<KioskState, { screen: 'template' }>
  dispatch: Dispatch<KioskAction>
  templates: Template[]
}

export function TemplateScreen({ state, dispatch, templates }: Props) {
  const t = useT()
  const allList = templates.length > 0 ? templates : DUMMY_TEMPLATES
  const filtered = allList.filter(t => t.category === state.category)
  const list = filtered.length > 0 ? filtered : allList

  return (
    <div className="screen-split flex flex-col w-full h-full overflow-hidden">
      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1
          className="h1-glow"
          style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}
        >
          {t('template_title') as string}
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618, whiteSpace: 'pre-line' }}>
          {t('template_subtitle') as string}
        </p>
      </div>

      <div className="screen-content">
        <div className="flex-1 min-h-0 overflow-y-auto px-5 template-scroll">
          <div className="grid grid-cols-4" style={{ gap: 12, paddingBottom: 24 }}>
            {list.map(tmpl => {
              const selected = state.selected?.id === tmpl.id
              return (
                <button
                  key={tmpl.id}
                  onClick={() => dispatch({ type: 'SELECT_TEMPLATE', template: tmpl })}
                  className="relative overflow-hidden active:scale-[0.97] transition-all duration-200"
                  style={{
                    borderRadius: 'var(--radius-btn)',
                    border: selected ? '2px solid rgba(255,255,255,0.7)' : 'none',
                    boxShadow: selected ? '0 0 20px rgba(255,255,255,0.2)' : 'inset 1px 1px 0 rgba(255,255,255,0.3), inset -1px -1px 0 rgba(0,0,0,0.2)',
                  }}
                >
                  <div className="w-full aspect-[2/3] relative flex items-center justify-center overflow-hidden" style={{ background: selected ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)' }}>
                    {tmpl.thumbnail_url
                      ? <img src={tmpl.thumbnail_url} alt={tmpl.name} className="absolute inset-0 w-full h-full object-cover" />
                      : <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-muted)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>{tmpl.name}</span>
                    }
                    {tmpl.category === SPINDONESIA_CATEGORY && (
                      <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
                        <PinBadge size={13} color="#fff" />
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="screen-actions shrink-0 p-5 flex gap-3">
        <TouchButton variant="secondary" onClick={() => dispatch({ type: 'BACK' })} className="flex-1">
          {t('nav_back') as string}
        </TouchButton>
        <TouchButton
          onClick={() => { if (state.selected) dispatch({ type: 'CONFIRM_TEMPLATE' }) }}
          disabled={!state.selected}
          className="flex-1"
        >
          {t('nav_next') as string}
        </TouchButton>
      </div>
    </div>
  )
}


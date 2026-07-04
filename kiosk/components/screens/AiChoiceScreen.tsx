'use client'
import type { Dispatch } from 'react'
import { TouchButton } from '@/components/ui/TouchButton'
import type { KioskAction, KioskState, Template } from '@/lib/types'

// Sentinel template — ProcessingScreen checks this id to skip AI generation.
// id CONTRACT: keep in sync with ProcessingScreen.tsx NO_AI_TEMPLATE_ID.
export const NO_AI_TEMPLATE: Template = {
  id: '__no_ai__',
  name: 'Original',
  category: 'original',
  token_cost: 0,
  thumbnail_url: null,
  gender_filter: 'ALL',
  engine_type: 'faceswap',
  positive_prompt: null,
  negative_prompt: null,
  api_endpoint: null,
  video_endpoint: null,
  video_positive_prompt: null,
  video_negative_prompt: null,
}

type Props = {
  state: Extract<KioskState, { screen: 'aichoice' }>
  dispatch: Dispatch<KioskAction>
}

export function AiChoiceScreen({ state, dispatch }: Props) {
  const goAI = () =>
    dispatch({ type: 'SET_STATE', state: { screen: 'category', imageUrl: state.imageUrl } })

  const goOri = () =>
    dispatch({
      type: 'SET_STATE',
      state: { screen: 'processing', progress: 0, step: 1, imageUrl: state.imageUrl, template: NO_AI_TEMPLATE, assignments: {} },
    })

  return (
    <div className="screen-split screen-split--center flex flex-col w-full h-full overflow-hidden">
      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1
          className="h1-glow"
          style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}
        >
          Mau foto seperti apa?
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618 }}>
          Pilih mode hasil fotomu
        </p>
      </div>

      <div className="screen-content flex-1 min-h-0 flex flex-col items-center justify-center gap-6 px-8">
        <div
          onClick={goAI}
          style={{
            width: '100%', maxWidth: 340,
            padding: '28px 24px',
            borderRadius: 20,
            background: 'linear-gradient(135deg, rgba(124,58,237,0.25), rgba(124,58,237,0.1))',
            border: '1px solid rgba(124,58,237,0.45)',
            cursor: 'pointer',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 10 }}>✨</div>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: '#fff', marginBottom: 4 }}>Pakai AI</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.5)' }}>Foto diubah dengan kecerdasan buatan</div>
        </div>

        <div
          onClick={goOri}
          style={{
            width: '100%', maxWidth: 340,
            padding: '28px 24px',
            borderRadius: 20,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            cursor: 'pointer',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 10 }}>📸</div>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: '#fff', marginBottom: 4 }}>Foto Original</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.5)' }}>Cetak foto aslimu tanpa perubahan</div>
        </div>
      </div>

      <div className="screen-actions shrink-0 p-5">
        <TouchButton variant="secondary" onClick={() => dispatch({ type: 'BACK' })} className="w-full">
          ← Ulangi Foto
        </TouchButton>
      </div>
    </div>
  )
}

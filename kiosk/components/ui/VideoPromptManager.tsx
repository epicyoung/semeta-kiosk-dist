import React, { useState, useEffect } from 'react'
import type { VideoPromptChoice, KioskConfig } from '../../lib/types'
import { useT } from '@/lib/i18n'

type Props = {
  open: boolean
  onClose: () => void
  config: KioskConfig
  onConfigChanged: (cfg: Partial<KioskConfig>) => void
}

export function VideoPromptManager({ open, onClose, config, onConfigChanged }: Props) {
  const t = useT()
  const [choices, setChoices] = useState<VideoPromptChoice[]>(config.video_prompt_choices ?? [])

  useEffect(() => {
    if (open) {
      setChoices(config.video_prompt_choices ?? [])
    }
  }, [open, config.video_prompt_choices])

  if (!open) return null

  const handleSave = async () => {
    try {
      await fetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_prompt_choices: choices }),
      })
      onConfigChanged({ video_prompt_choices: choices })
      onClose()
    } catch (err) {
      console.error('Failed to save video prompts', err)
    }
  }

  const addChoice = () => {
    setChoices([...choices, { id: crypto.randomUUID(), title: t('vpm_new_choice_title') as string, positive_prompt: '', negative_prompt: '' }])
  }

  const removeChoice = (id: string) => {
    setChoices(choices.filter(c => c.id !== id))
  }

  const updateChoice = (id: string, field: keyof VideoPromptChoice, value: string) => {
    setChoices(choices.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(9,1,53,0.9)', backdropFilter: 'blur(20px)',
      display: 'flex', flexDirection: 'column', color: '#fff'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '24px 32px', borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
            {t('vpm_title') as string}
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)', margin: 0 }}>
            {t('vpm_subtitle') as string}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={onClose} style={{
            padding: '12px 24px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 'var(--radius-glass)', color: '#fff', fontSize: 'var(--text-sm)', cursor: 'pointer'
          }}>{t('vpm_cancel') as string}</button>
          <button onClick={handleSave} style={{
            padding: '12px 24px', background: 'var(--brand)', border: 'none',
            borderRadius: 'var(--radius-glass)', color: '#fff', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer'
          }}>{t('vpm_save') as string}</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
          {choices.map((c, i) => (
            <div key={c.id} style={{
              flex: '1 1 400px',
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 'var(--radius-preview)', padding: 24
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-ui)' }}>{t('vpm_choice_label') as string} #{i + 1}</span>
                <button onClick={() => removeChoice(c.id)} style={{
                  background: 'rgba(255,107,107,0.1)', color: '#ff6b6b', border: 'none',
                  borderRadius: 6, padding: '4px 8px', fontSize: 'var(--text-xs)', cursor: 'pointer'
                }}>{t('vpm_remove') as string}</button>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>{t('vpm_field_title') as string}</label>
                <input
                  value={c.title}
                  onChange={e => updateChoice(c.id, 'title', e.target.value)}
                  placeholder={t('vpm_field_title_ph') as string}
                  style={{
                    width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6, color: '#fff', padding: '10px 12px', fontSize: 'var(--text-sm)'
                  }}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>{t('vpm_field_positive') as string}</label>
                <textarea
                  value={c.positive_prompt}
                  onChange={e => updateChoice(c.id, 'positive_prompt', e.target.value)}
                  placeholder={t('vpm_field_positive_ph') as string}
                  rows={4}
                  style={{
                    width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6, color: '#fff', padding: '10px 12px', fontSize: 'var(--text-sm)', resize: 'vertical'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>{t('vpm_field_negative') as string}</label>
                <textarea
                  value={c.negative_prompt}
                  onChange={e => updateChoice(c.id, 'negative_prompt', e.target.value)}
                  placeholder={t('vpm_field_negative_ph') as string}
                  rows={3}
                  style={{
                    width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6, color: '#fff', padding: '10px 12px', fontSize: 'var(--text-sm)', resize: 'vertical'
                  }}
                />
              </div>
            </div>
          ))}
          
          <div
            onClick={addChoice}
            style={{
              flex: '1 1 400px', minHeight: 200,
              background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.2)',
              borderRadius: 'var(--radius-preview)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'background 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
          >
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
              <div style={{ fontSize: 'var(--text-3xl)', marginBottom: 8 }}>+</div>
              <div style={{ fontSize: 'var(--text-sm)' }}>{t('vpm_add') as string}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'
import { useState, useEffect, useRef } from 'react'
import { TouchButton } from './TouchButton'
import { LayoutDesigner } from './LayoutDesigner'
import type { Template, PrintSize } from '@/lib/types'

type Props = {
  onRefreshTemplates?: (templates: Template[]) => void
}

export function LocalTemplateManager({ onRefreshTemplates }: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [activeDesignerTemplate, setActiveDesignerTemplate] = useState<Template | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchTemplates = () => {
    setLoading(true)
    fetch('/api/local-templates')
      .then(r => r.json())
      .then(data => setTemplates(data.templates || []))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchTemplates()
  }, [])

  const saveTemplates = async (newTemplates: Template[]) => {
    await fetch('/api/save-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTemplates)
    })
    setTemplates(newTemplates)
    onRefreshTemplates?.(newTemplates)
  }

  const handleUploadOverlay = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload-local-asset', { method: 'POST', body: fd })
      const data = await res.json()
      
      if (data.url) {
        const newTemplate: Template = {
          id: `local_${Date.now()}`,
          name: `Print Template ${templates.length + 1}`,
          category: 'Local Print',
          gender_filter: 'ALL',
          engine_type: 'print',
          token_cost: 0, // print = non-AI, no token burn
          thumbnail_url: data.url, // For print, thumbnail can be the overlay itself
          positive_prompt: null,
          negative_prompt: null,
          api_endpoint: null,
          video_endpoint: null,
          video_positive_prompt: null,
          video_negative_prompt: null,
          shot_count: 4,
          print_size: '4R_PORTRAIT',
          overlay_url: data.url,
        }
        await saveTemplates([...templates, newTemplate])
      }
    } catch (err) {
      alert('Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (id: string) => {
    await saveTemplates(templates.filter(t => t.id !== id))
  }

  const updateTemplate = async (id: string, updates: Partial<Template>) => {
    await saveTemplates(templates.map(t => t.id === id ? { ...t, ...updates } : t))
  }

  const printTemplates = templates.filter(t => t.engine_type === 'print')

  if (loading) return <p style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.5)' }}>Loading...</p>

  if (activeDesignerTemplate) {
    return (
      <LayoutDesigner
        template={activeDesignerTemplate}
        onClose={() => setActiveDesignerTemplate(null)}
        onSave={async (layoutConfig) => {
          await updateTemplate(activeDesignerTemplate.id, { layout_config: layoutConfig })
          setActiveDesignerTemplate(null)
        }}
      />
    )
  }

  return (
    <div style={{ marginTop: 16, padding: 18, background: 'rgba(9,1,53,0.35)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--brand)', fontWeight: 700 }}>
            Photo Print
          </span>
          <p style={{ fontSize: 'var(--text-sm)', color: '#fff', margin: 0, fontWeight: 600 }}>
            Local Print Templates
          </p>
        </div>
        <TouchButton
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : '+ Add Overlay'}
        </TouchButton>
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ visibility: 'hidden', position: 'absolute', width: 0, height: 0 }} 
          accept="image/png" 
          onChange={handleUploadOverlay} 
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {printTemplates.length === 0 && (
          <div style={{ textAlign: 'center', padding: '28px 12px', border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 12 }}>
            <p style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.55)', margin: 0, fontWeight: 600 }}>No print templates yet</p>
            <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.4)', margin: '4px 0 0' }}>Upload a transparent PNG overlay to create one.</p>
          </div>
        )}

        {printTemplates.map(t => {
          const isLandscape = t.print_size === '4R_LANDSCAPE'
          return (
          <div key={t.id} style={{ display: 'flex', gap: 14, background: 'rgba(255,255,255,0.04)', padding: 12, borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{
              width: isLandscape ? 108 : 68, height: 90,
              background: '#f4f2ec', borderRadius: 6, overflow: 'hidden', flexShrink: 0,
              boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
            }}>
              <img src={t.overlay_url || t.thumbnail_url || ''} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="overlay" />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input 
                value={t.name}
                onChange={e => updateTemplate(t.id, { name: e.target.value })}
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 'var(--text-xs)', fontWeight: 500, outline: 'none' }}
              />
              
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select 
                  value={t.print_size || '4R_PORTRAIT'}
                  onChange={e => updateTemplate(t.id, { print_size: e.target.value as PrintSize })}
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.13)', color: '#fff', borderRadius: 'var(--radius-glass)', padding: '4px 8px', fontSize: 'var(--text-xs)', outline: 'none', cursor: 'pointer' }}
                >
                  <option value="4R_PORTRAIT" style={{ background: '#110b32', color: '#fff' }}>4R Portrait</option>
                  <option value="4R_LANDSCAPE" style={{ background: '#110b32', color: '#fff' }}>4R Landscape</option>
                  <option value="2R_STRIP" style={{ background: '#110b32', color: '#fff' }}>2 Strip (2R)</option>
                </select>

                <select 
                  value={t.shot_count || 4}
                  onChange={e => updateTemplate(t.id, { shot_count: parseInt(e.target.value) })}
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.13)', color: '#fff', borderRadius: 'var(--radius-glass)', padding: '4px 8px', fontSize: 'var(--text-xs)', outline: 'none', cursor: 'pointer' }}
                >
                  <option value={1} style={{ background: '#110b32', color: '#fff' }}>1 Shot</option>
                  <option value={2} style={{ background: '#110b32', color: '#fff' }}>2 Shots</option>
                  <option value={3} style={{ background: '#110b32', color: '#fff' }}>3 Shots</option>
                  <option value={4} style={{ background: '#110b32', color: '#fff' }}>4 Shots</option>
                </select>
              </div>

              <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  onClick={() => setActiveDesignerTemplate(t)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 999, padding: '6px 14px', fontSize: 'var(--text-2xs)', cursor: 'pointer', fontWeight: 600, boxShadow: '0 6px 16px -6px var(--brand)' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                  </svg>
                  Layout Studio
                </button>
                <button
                  onClick={() => handleDelete(t.id)}
                  style={{ background: 'transparent', color: 'rgba(255,145,145,0.85)', border: 'none', fontSize: 'var(--text-2xs)', cursor: 'pointer', fontWeight: 500 }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
}

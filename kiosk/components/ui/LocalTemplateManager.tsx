'use client'
import { useState, useEffect, useRef } from 'react'
import { TouchButton } from './TouchButton'
import { LayoutDesigner } from './LayoutDesigner'
import { PrintLayoutPreview } from './PrintLayoutPreview'
import type { Template, PrintSize } from '@/lib/types'
import { CANVAS_4R_PORTRAIT, CANVAS_4R_LANDSCAPE, PANEL_2R_STRIP } from '@/lib/print-layout'
import { useT } from '@/lib/i18n'
import type { Translations } from '@/lib/locales/types'

type Props = {
  onRefreshTemplates?: (templates: Template[]) => void
}

// ── Print Style visual config ────────────────────────────────────────────────
// Text labels/descs live in i18n; only icon is fixed here.
type PrintStyle = '4R' | '2_STRIPE'
const STYLE_ICON: Record<PrintStyle, string> = { '4R': '🖼️', '2_STRIPE': '📸' }
const STYLE_LABEL_KEY: Record<PrintStyle, keyof Translations> = { '4R': 'ltm_style_4r_label', '2_STRIPE': 'ltm_style_2stripe_label' }
const STYLE_DESC_KEY: Record<PrintStyle, keyof Translations> = { '4R': 'ltm_style_4r_desc', '2_STRIPE': 'ltm_style_2stripe_desc' }

// Derive PrintSize from style + orientation
function derivePrintSize(style: PrintStyle, orientation: 'portrait' | 'landscape'): PrintSize {
  if (style === '2_STRIPE') return '2R_STRIP'
  return orientation === 'landscape' ? '4R_LANDSCAPE' : '4R_PORTRAIT'
}

function deriveStyle(ps: PrintSize | null | undefined): PrintStyle {
  if (ps === '2R_STRIP') return '2_STRIPE'
  return '4R'
}

function deriveOrientation(ps: PrintSize | null | undefined): 'portrait' | 'landscape' {
  if (ps === '4R_LANDSCAPE') return 'landscape'
  return 'portrait'
}

// ── Canvas spec for preview badges ──────────────────────────────────────────
function canvasForSize(ps: PrintSize) {
  if (ps === '4R_LANDSCAPE') return CANVAS_4R_LANDSCAPE
  if (ps === '2R_STRIP') return PANEL_2R_STRIP
  return CANVAS_4R_PORTRAIT
}

export function LocalTemplateManager({ onRefreshTemplates }: Props) {
  const t = useT()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [activeDesignerTemplate, setActiveDesignerTemplate] = useState<Template | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Which template is open in the expanded editor (id or null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
          name: `${t('ltm_default_name') as string} ${templates.length + 1}`,
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
        const next = [...templates, newTemplate]
        await saveTemplates(next)
        setExpandedId(newTemplate.id)
      }
    } catch (err) {
      alert(t('ltm_upload_failed') as string)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (id: string) => {
    if (expandedId === id) setExpandedId(null)
    await saveTemplates(templates.filter(t => t.id !== id))
  }

  const updateTemplate = async (id: string, updates: Partial<Template>) => {
    await saveTemplates(templates.map(t => t.id === id ? { ...t, ...updates } : t))
  }

  const printTemplates = templates.filter(t => t.engine_type === 'print')

  if (loading) return <p style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.5)' }}>{t('ltm_loading') as string}</p>

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
            {t('ltm_section_kicker') as string}
          </span>
          <p style={{ fontSize: 'var(--text-sm)', color: '#fff', margin: 0, fontWeight: 600 }}>
            {t('ltm_section_title') as string}
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            padding: '8px 14px', borderRadius: 8,
            background: 'rgba(255,255,255,0.04)',
            border: '1.5px solid rgba(255,255,255,0.08)',
            color: '#fff', cursor: uploading ? 'default' : 'pointer', fontSize: 'var(--text-xs)', fontWeight: 600,
            transition: 'all 150ms ease',
            opacity: uploading ? 0.5 : 1
          }}
        >
          {uploading ? t('ltm_uploading') as string : t('ltm_add_overlay') as string}
        </button>
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
            <p style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.55)', margin: 0, fontWeight: 600 }}>{t('ltm_empty_title') as string}</p>
            <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.4)', margin: '4px 0 0' }}>{t('ltm_empty_body') as string}</p>
            <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.25)', margin: '4px 0 0', fontFamily: 'var(--font-ui)' }}>{t('ltm_empty_spec') as string}</p>
          </div>
        )}

        {printTemplates.map(tmpl => {
          const currentStyle = deriveStyle(tmpl.print_size)
          const currentOrientation = deriveOrientation(tmpl.print_size)
          const currentSize = tmpl.print_size || '4R_PORTRAIT'
          const canvas = canvasForSize(currentSize)
          const isExpanded = expandedId === tmpl.id
          const isLandscape = currentOrientation === 'landscape'

          return (
          <div key={tmpl.id} style={{
            background: 'rgba(255,255,255,0.04)', borderRadius: 14,
            border: isExpanded ? '1px solid rgba(124,58,237,0.4)' : '1px solid rgba(255,255,255,0.06)',
            transition: 'border-color 200ms ease',
            overflow: 'hidden',
          }}>
            {/* ── Collapsed summary row ─────────────────────────────────── */}
            <div
              style={{
                display: 'flex', gap: 14, padding: 12, cursor: 'pointer',
                alignItems: 'center',
              }}
              onClick={() => setExpandedId(isExpanded ? null : tmpl.id)}
            >
              {/* Thumbnail — scale-matched to orientation */}
              <div style={{
                width: isLandscape || currentStyle === '2_STRIPE' ? 90 : 60,
                height: isLandscape ? 60 : 90,
                background: '#272729', borderRadius: 6, overflow: 'hidden', flexShrink: 0,
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {/* Live mini preview — uses real layout engine */}
                <PrintLayoutPreview
                  template={tmpl}
                  shots={Array.from({ length: tmpl.shot_count ?? 4 }, () => '')}
                />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tmpl.name}
                </p>
                <p style={{ margin: '3px 0 0', fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.45)' }}>
                  {STYLE_ICON[currentStyle]} {t(STYLE_LABEL_KEY[currentStyle]) as string}
                  <span style={{ margin: '0 6px', color: 'rgba(255,255,255,0.15)' }}>·</span>
                  {tmpl.shot_count ?? 4} {t('ltm_shots_suffix') as string}
                  {currentStyle === '4R' && (
                    <>
                      <span style={{ margin: '0 6px', color: 'rgba(255,255,255,0.15)' }}>·</span>
                      {currentOrientation}
                    </>
                  )}
                </p>
              </div>

              {/* Expand chevron */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ flexShrink: 0, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 200ms ease' }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            {/* ── Expanded editor ───────────────────────────────────────── */}
            {isExpanded && (
              <div style={{ padding: '0 12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Template Name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.4)', width: 50, flexShrink: 0 }}>{t('ltm_name') as string}</span>
                  <input
                    value={tmpl.name}
                    onChange={e => updateTemplate(tmpl.id, { name: e.target.value })}
                    style={{
                      flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#fff', fontSize: 'var(--text-xs)', fontWeight: 500, outline: 'none',
                      borderRadius: 'var(--radius-glass)', padding: '7px 10px',
                    }}
                  />
                </div>

                {/* ── STEP 1: Print Style ──────────────────────────── */}
                <div>
                  <span style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', fontWeight: 700, display: 'block', marginBottom: 8 }}>
                    {t('ltm_step1') as string}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['4R', '2_STRIPE'] as PrintStyle[]).map(style => {
                      const active = currentStyle === style
                      return (
                        <button
                          key={style}
                          onClick={() => {
                            const newSize = derivePrintSize(style, currentOrientation)
                            updateTemplate(tmpl.id, { print_size: newSize, layout_config: null })
                          }}
                          style={{
                            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                            padding: '14px 10px', borderRadius: 10,
                            background: active ? 'rgba(124,58,237,0.18)' : 'rgba(255,255,255,0.04)',
                            border: active ? '1.5px solid rgba(124,58,237,0.6)' : '1.5px solid rgba(255,255,255,0.08)',
                            color: '#fff', cursor: 'pointer',
                            transition: 'all 150ms ease',
                          }}
                        >
                          <span style={{ fontSize: 22 }}>{STYLE_ICON[style]}</span>
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>{t(STYLE_LABEL_KEY[style]) as string}</span>
                          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 1.3 }}>{t(STYLE_DESC_KEY[style]) as string}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* ── 4R: Orientation toggle ─────────────────────── */}
                {currentStyle === '4R' && (
                  <div>
                    <span style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', fontWeight: 700, display: 'block', marginBottom: 8 }}>
                      {t('ltm_orientation') as string}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['portrait', 'landscape'] as const).map(ori => {
                        const active = currentOrientation === ori
                        return (
                          <button
                            key={ori}
                            onClick={() => {
                              updateTemplate(tmpl.id, { print_size: derivePrintSize('4R', ori), layout_config: null })
                            }}
                            style={{
                              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                              padding: '10px 0', borderRadius: 8,
                              background: active ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.04)',
                              border: active ? '1.5px solid rgba(124,58,237,0.5)' : '1.5px solid rgba(255,255,255,0.08)',
                              color: '#fff', cursor: 'pointer', transition: 'all 150ms ease',
                            }}
                          >
                            {/* Mini artboard icon */}
                            <div style={{
                              width: ori === 'landscape' ? 28 : 18,
                              height: ori === 'landscape' ? 18 : 28,
                              borderRadius: 3,
                              border: active ? '2px solid rgba(124,58,237,0.8)' : '2px solid rgba(255,255,255,0.25)',
                              transition: 'border-color 150ms ease',
                            }} />
                            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, textTransform: 'capitalize' }}>{ori}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* ── STEP 2: Shot Count ───────────────────────────── */}
                <div>
                  <span style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', fontWeight: 700, display: 'block', marginBottom: 8 }}>
                    {t('ltm_step2') as string}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[1, 2, 3, 4].map(n => {
                      const active = (tmpl.shot_count ?? 4) === n
                      return (
                        <button
                          key={n}
                          onClick={() => updateTemplate(tmpl.id, { shot_count: n, layout_config: null })}
                          style={{
                            flex: 1, padding: '10px 0', borderRadius: 8,
                            background: active ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.04)',
                            border: active ? '1.5px solid rgba(124,58,237,0.5)' : '1.5px solid rgba(255,255,255,0.08)',
                            color: '#fff', cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 600,
                            transition: 'all 150ms ease',
                          }}
                        >
                          {n} {t('ltm_shots_suffix') as string}{n > 1 ? 's' : ''}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* ── Canvas spec badge ─────────────────────────────── */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  padding: '8px 14px', borderRadius: 8,
                  background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                  fontSize: 11, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums',
                }}>
                  <strong style={{ color: '#fff', fontWeight: 600 }}>
                    {currentStyle === '2_STRIPE' ? '2 Stripe (2R)' : `4R ${currentOrientation}`}
                  </strong>
                  {canvas.w} × {canvas.h} px
                  <span style={{ color: 'rgba(255,255,255,0.3)' }}>@ 300dpi</span>
                  {currentStyle === '2_STRIPE' && (
                    <span style={{ color: 'rgba(124,58,237,0.7)', fontWeight: 600 }}>→ 2-up on 4R sheet</span>
                  )}
                </div>

                {/* ── Step 3: Layout Studio + Actions ─────────────── */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    onClick={() => setActiveDesignerTemplate(tmpl)}
                    style={{
                      flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 999,
                      padding: '10px 18px', fontSize: 'var(--text-xs)', cursor: 'pointer', fontWeight: 600,
                      boxShadow: '0 6px 16px -6px var(--brand)',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                    </svg>
                    {t('ltm_layout_studio') as string}
                  </button>
                  <button
                    onClick={() => handleDelete(tmpl.id)}
                    style={{
                      background: 'transparent', color: 'rgba(255,145,145,0.85)', border: '1px solid rgba(255,145,145,0.2)',
                      borderRadius: 999, padding: '10px 18px', fontSize: 'var(--text-xs)',
                      cursor: 'pointer', fontWeight: 500,
                    }}
                  >
                    {t('ltm_delete') as string}
                  </button>
                </div>
              </div>
            )}
          </div>
          )
        })}
      </div>
    </div>
  )
}

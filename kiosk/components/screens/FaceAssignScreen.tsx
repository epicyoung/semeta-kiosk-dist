'use client'
import { useState, useRef, useLayoutEffect, useEffect, type Dispatch } from 'react'
import { TouchButton } from '@/components/ui/TouchButton'
import type { KioskAction, KioskState } from '@/lib/types'
import { detectUserFaces, detectTemplateSlots, cropImage } from '@/lib/facedetect'
import { useT } from '@/lib/i18n'

const GAP = 12
const VISIBLE = 5

type Props = {
  state: Extract<KioskState, { screen: 'faceassign' }>
  dispatch: Dispatch<KioskAction>
}

export function FaceAssignScreen({ state, dispatch }: Props) {
  const t = useT()
  const { template, faces, templateSlots } = state
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState(true)
  const [face, setFace] = useState(80)
  const [slotCrops, setSlotCrops] = useState<Record<string, string>>({})
  const [detecting, setDetecting] = useState(faces.length === 0 && templateSlots.length === 0)
  const rowRef = useRef<HTMLDivElement>(null)

  // Detect faces on mount when state is empty (real flow, not dev nav)
  useEffect(() => {
    if (faces.length > 0 || templateSlots.length > 0) { setDetecting(false); return }

    async function detect() {
      const [userFaces, slots] = await Promise.all([
        detectUserFaces(state.imageUrl),
        template?.thumbnail_url ? detectTemplateSlots(template.thumbnail_url) : Promise.resolve([]),
      ])

      // Crop template slot previews into local state (FaceSlot type stays clean)
      if (template?.thumbnail_url && slots.length > 0) {
        const crops: Record<string, string> = {}
        await Promise.all(slots.map(async s => {
          const url = await cropImage(template.thumbnail_url!, s).catch(() => undefined)
          if (url) crops[s.id] = url
        }))
        setSlotCrops(crops)
      }

      dispatch({ type: 'GO_FACE_ASSIGN', faces: userFaces, templateSlots: slots })
      setDetecting(false)
    }

    detect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = rowRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      setFace(Math.max(40, Math.floor((w - GAP * (VISIBLE - 1)) / VISIBLE) - 1))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pick = (slotId: string, faceId: string) => {
    setAssignments(prev => {
      const next = { ...prev }
      if (next[slotId] === faceId) { delete next[slotId]; return next }
      Object.keys(next).forEach(k => { if (next[k] === faceId) delete next[k] })
      next[slotId] = faceId
      return next
    })
  }

  const canProceed = Object.keys(assignments).length > 0

  if (detecting) return (
    <div className="flex items-center justify-center w-full h-full flex-col gap-3">
      <div className="animate-spin" style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.7)' }} />
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>{t('faceassign_detecting') as string}</p>
    </div>
  )

  return (
    <div className="screen-split screen-split--center flex flex-col w-full h-full overflow-hidden">
      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1 className="h1-glow" style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>
          {t('faceassign_title') as string}
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618, whiteSpace: 'pre-line' }}>
          {t('faceassign_subtitle') as string}
        </p>
      </div>

      <div className="screen-content">
        <div className="flex-1 flex items-center gap-4 px-5 min-h-0 overflow-hidden">
          {/* Left: template card */}
          <div
            onClick={() => setExpanded(!expanded)}
            style={{ flexShrink: 0, width: expanded ? '40%' : 36, aspectRatio: expanded ? '2/3' : undefined, height: expanded ? undefined : '80%', maxHeight: '80%', borderRadius: 'var(--radius-btn)', border: 'none', boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.3), inset -1px -1px 0 rgba(0,0,0,0.2)', background: 'rgba(255,255,255,0.08)', overflow: 'hidden', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {expanded ? (
              <>
                {template?.thumbnail_url
                  ? <img src={template.thumbnail_url} className="w-full h-full object-cover" alt="template" />
                  : <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-muted)', letterSpacing: '0.15em', textTransform: 'uppercase', writingMode: 'vertical-rl' }}>TEMPLATE</span>
                }
                <div style={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 'var(--radius-chip)', background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </div>
              </>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            )}
          </div>

          {/* Right: one row per template slot */}
          <div className="flex-1 overflow-y-auto template-scroll flex flex-col justify-center gap-6 py-4" style={{ maxHeight: '100%' }}>
            {templateSlots.length === 0 ? (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', textAlign: 'center' }}>{t('faceassign_no_faces_in_template') as string}</p>
            ) : templateSlots.map((slot, si) => (
              <div key={slot.id}>
                <div style={{ fontSize: 'var(--text-2xs)', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 8 }}>
                  {t('faceassign_person_label') as string} {si + 1}
                </div>
                <div
                  ref={si === 0 ? rowRef : undefined}
                  className="flex gap-3"
                  style={{ overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
                >
                  {/* Template face preview for this slot (unclickable) */}
                  {slotCrops[slot.id] && (
                    <div style={{ width: face, height: face, borderRadius: 16, overflow: 'hidden', flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)', pointerEvents: 'none' }}>
                      <img src={slotCrops[slot.id]} className="w-full h-full object-cover" alt="template face" />
                    </div>
                  )}
                  {/* User faces */}
                  {faces.map(f => {
                    const isPicked = assignments[slot.id] === f.id
                    return (
                      <button
                        key={f.id}
                        onClick={() => pick(slot.id, f.id)}
                        className="active:scale-95 transition-all duration-150"
                        style={{
                          width: face, height: face, borderRadius: 16, overflow: 'hidden', flexShrink: 0, position: 'relative',
                          border: isPicked ? '2px solid rgba(255,255,255,0.85)' : '2px solid rgba(255,255,255,0.12)',
                          boxShadow: isPicked ? '0 0 16px rgba(255,255,255,0.3)' : 'none',
                          background: 'rgba(255,255,255,0.06)',
                        }}
                      >
                        {f.cropUrl && <img src={f.cropUrl} className="w-full h-full object-cover" alt={`face ${f.id}`} />}
                        {isPicked && (
                          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
                            <span style={{ fontSize: 'var(--text-lg)' }}>✓</span>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="screen-actions shrink-0 p-5 flex gap-3">
        <TouchButton variant="secondary" onClick={() => dispatch({ type: 'BACK' })} className="flex-1">
          {t('nav_back') as string}
        </TouchButton>
        <TouchButton onClick={() => dispatch({ type: 'START_PROCESSING' })} disabled={!canProceed} className="flex-1">
          {t('nav_next') as string}
        </TouchButton>
      </div>
    </div>
  )
}

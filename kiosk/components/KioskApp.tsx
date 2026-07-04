'use client'
import { useReducer, useRef, useEffect, useState } from 'react'
import { kioskReducer, initialState } from '@/lib/reducer'
import { useCountdown, useHeartbeat } from '@/lib/billing'
import { logVisitorEvent } from '@/lib/analytics'
import { LockScreen } from '@/components/LockScreen'
import { InactivityReset } from '@/components/ui/InactivityReset'
import { GlassShell } from '@/components/ui/GlassShell'
import { IdleScreen } from '@/components/screens/IdleScreen'
import { LiveViewScreen } from '@/components/screens/LiveViewScreen'
import { CategoryScreen } from '@/components/screens/CategoryScreen'
import { TemplateScreen } from '@/components/screens/TemplateScreen'
import { AiChoiceScreen } from '@/components/screens/AiChoiceScreen'
import { FaceAssignScreen } from '@/components/screens/FaceAssignScreen'
import { ProcessingScreen } from '@/components/screens/ProcessingScreen'
import { PreviewScreen } from '@/components/screens/PreviewScreen'
import { ExpiredScreen } from '@/components/screens/ExpiredScreen'
import { ConsentScreen } from '@/components/screens/ConsentScreen'
import type { KioskConfig, KioskState } from '@/lib/types'
import { SPINDONESIA_CATEGORY } from '@/lib/spindonesia-category'
import { useOrientedFrames } from '@/lib/frames'

const SCREEN_ORDER: KioskState['screen'][] = [
  'idle', 'consent', 'liveview', 'aichoice', 'category', 'template', 'faceassign', 'processing', 'preview',
]

const DUMMY_TEMPLATE = { id: 'd1', name: 'Template 1', category: 'faceswap', token_cost: 1, thumbnail_url: null, gender_filter: 'ALL' as const, engine_type: 'faceswap' as const, positive_prompt: null, negative_prompt: null, api_endpoint: null, video_endpoint: null, video_positive_prompt: null, video_negative_prompt: null }

const SCREEN_INIT: Partial<Record<KioskState['screen'], KioskState>> = {
  idle:       { screen: 'idle' },
  consent:    { screen: 'consent' },
  liveview:   { screen: 'liveview' },
  aichoice:   { screen: 'aichoice', imageUrl: '' },
  category:   { screen: 'category', imageUrl: '' },
  template:   { screen: 'template', imageUrl: '', category: 'cat-1', selected: null },
  faceassign: {
    screen: 'faceassign', imageUrl: '', category: 'cat-1', template: DUMMY_TEMPLATE,
    faces: [
      { id: 'face_1', x: 0, y: 0, w: 80, h: 80, cropUrl: '/a.jpg' },
      { id: 'face_2', x: 0, y: 0, w: 80, h: 80, cropUrl: '/b.jpg' },
      { id: 'face_3', x: 0, y: 0, w: 80, h: 80, cropUrl: '/c.jpg' },
    ],
    templateSlots: [
      { id: 'slot_1', x: 0, y: 0, w: 80, h: 80 },
      { id: 'slot_2', x: 0, y: 0, w: 80, h: 80 },
    ],
    assignments: {},
  },
  processing: { screen: 'processing', progress: 0, step: 1, imageUrl: '', template: DUMMY_TEMPLATE, assignments: {} },
  preview:    { screen: 'preview', aiUrl: '', originalUrl: '', selectedFrame: null },
}

function getInitialState(): KioskState {
  // Always return initialState for SSR — client syncs from hash in useEffect
  return initialState
}

// ponytail: licensing active only when server sends remaining_sec > 0
const licensingEnabled = (cfg: KioskConfig) =>
  typeof cfg.remaining_sec === 'number' && cfg.remaining_sec > 0

export function KioskApp({ config }: { config: KioskConfig }) {
  const [state, dispatch] = useReducer(kioskReducer, undefined, getInitialState)
  // config.templates sudah di-prepend spindonesia (cloud, pinned) di fetchKioskConfig.
  // Simpan subset spindonesia biar pas Settings re-fetch (PB lokal only) tetep di-prepend.
  const spindonesiaPinned = useRef(config.templates.filter(t => t.category === SPINDONESIA_CATEGORY))
  const withPin = (list: KioskConfig['templates']) =>
    [...spindonesiaPinned.current, ...list.filter(t => t.category !== SPINDONESIA_CATEGORY)]
  const [templates, setTemplates] = useState(config.templates)
  const orientedFrames = useOrientedFrames(config.frames)
  const direction = useRef<'forward' | 'backward'>('forward')

  const { isExpired, pause, resume, refill } = useCountdown(config.remaining_sec ?? 0)
  // Seed: page.tsx baru aja handshake sukses sebelum render, jadi "last OK" = mount time.
  const lastOkAt = useRef(Date.now())
  // Heartbeat: refill saat sukses, lock saat verdict server, grace 12 jam saat offline.
  useHeartbeat((sec, forceLocked, _lockReason, lockMessage) => {
    // ponytail: hanya force_locked dari admin yang nampilin lock screen
    if (forceLocked) { dispatch({ type: 'FORCE_LOCKED', reason: 'force_locked', message: lockMessage }); return }
    if (sec === -1) return // offline → jalan terus (freeware)
    lastOkAt.current = Date.now()
    refill(sec)
  })

  // Analytics refs — no re-renders
  const visitorId = useRef<string | null>(null)
  const retakeCount = useRef(0)
  const processingStartMs = useRef<number | null>(null)
  // secret_hint is the kiosk secret passed from the server component — safe, already in config
  const secret = useRef(config.secret_hint ?? '')

  const log = (event_type: string, metadata: Record<string, unknown> = {}) =>
    logVisitorEvent(event_type, { visitor_id: visitorId.current, event_name: config.event_name, ...metadata }, secret.current)

  const wrappedDispatch: typeof dispatch = (action) => {
    if ('type' in action && (action.type === 'BACK' || action.type === 'RESET')) {
      direction.current = 'backward'
    } else {
      direction.current = 'forward'
    }

    // ── Analytics interception ───────────────────────────────────────────
    if ('type' in action) {
      switch (action.type) {
        case 'CONSENT_GIVEN':
          visitorId.current = crypto.randomUUID()
          retakeCount.current = 0
          log('CONSENT_GIVEN', {})
          break
        case 'CAPTURE': {
          retakeCount.current += 1
          log('VISITOR_PHOTO_TAKEN', { retake_count: retakeCount.current })
          if (config.enable_ai_choice && 'imageUrl' in action) {
            direction.current = 'forward'
            dispatch({ type: 'SET_STATE', state: { screen: 'aichoice', imageUrl: action.imageUrl } })
            return // skip reducer dispatch below
          }
          break
        }
        case 'SELECT_CATEGORY':
          log('VISITOR_CATEGORY_SELECTED', { category: action.category })
          break
        case 'CONFIRM_TEMPLATE': {
          const s = state as Extract<KioskState, { screen: 'template' }>
          if (s.selected) log('VISITOR_TEMPLATE_SELECTED', { template_id: s.selected.id, template_name: s.selected.name })
          break
        }
        case 'START_PROCESSING':
          processingStartMs.current = Date.now()
          log('VISITOR_PROCESSING_START')
          break
        case 'SHOW_PREVIEW': {
          const duration_ms = processingStartMs.current ? Date.now() - processingStartMs.current : null
          log('VISITOR_PROCESSING_DONE', { ...(duration_ms !== null && { duration_ms }) })
          log('VISITOR_PREVIEW_VIEWED')
          break
        }
        case 'RESET':
          if (state.screen === 'preview') log('VISITOR_ACTION', { action: 'skipped' })
          visitorId.current = null
          retakeCount.current = 0
          processingStartMs.current = null
          break
      }
    }
    // ────────────────────────────────────────────────────────────────────

    dispatch(action)
  }

  // Sync hash → state once on mount (dev nav via URL hash)
  useEffect(() => {
    let hash = window.location.hash.replace('#', '')
    if (hash === 'error') hash = 'processing'
    const devState = SCREEN_INIT[hash as KioskState['screen']]
    if (devState && hash !== 'idle' && hash !== 'force_locked') dispatch({ type: 'SET_STATE', state: devState as KioskState })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (window.location.hash === '#error') return // ponytail: biarin #error preview
    if (window.location.hash.replace('#', '') !== state.screen)
      window.location.hash = state.screen
  }, [state.screen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const idx = SCREEN_ORDER.indexOf(state.screen)
      const next = e.key === 'ArrowRight' ? SCREEN_ORDER[idx + 1] : SCREEN_ORDER[idx - 1]
      if (!next || !SCREEN_INIT[next]) return
      direction.current = e.key === 'ArrowRight' ? 'forward' : 'backward'
      // ponytail: dispatch SET_STATE langsung buat dev nav, bukan flow normal
      dispatch({ type: 'SET_STATE', state: SCREEN_INIT[next] as KioskState })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.screen])

  if (state.screen === 'force_locked') {
    return <LockScreen reason={state.reason ?? 'force_locked'} hasSecret={true} message={state.message ?? config.lock_message} />
  }

  const screen = (() => {
    switch (state.screen) {
      case 'idle':        return <IdleScreen dispatch={wrappedDispatch} />
      case 'consent':     return <ConsentScreen dispatch={wrappedDispatch} />
      case 'liveview':    return <LiveViewScreen state={state} dispatch={wrappedDispatch} />
      case 'aichoice':    return <AiChoiceScreen state={state} dispatch={wrappedDispatch} />
      case 'category':    return <CategoryScreen state={state} dispatch={wrappedDispatch} templates={templates} />
      case 'template':    return <TemplateScreen state={state} dispatch={wrappedDispatch} templates={templates} />
      case 'faceassign':  return <FaceAssignScreen state={state} dispatch={wrappedDispatch} />
      case 'processing':  return <ProcessingScreen state={state} dispatch={wrappedDispatch} generationSource={config.generation_source} eventName={config.event_name} licensed={config.licensed ?? false} onUploadFailed={(meta) => log('UPLOAD_FAILED', meta)} />
      case 'preview':     return <PreviewScreen state={state} dispatch={wrappedDispatch} frames={orientedFrames} config={config} licensed={config.licensed ?? false} eventName={config.event_name} onAction={(a) => log('VISITOR_ACTION', { action: a })} />
    }
  })()

  return (
    <InactivityReset screen={state.screen} dispatch={wrappedDispatch}>
      <GlassShell screenKey={state.screen} direction={direction.current} config={config} onLogoClick={state.screen !== 'idle' ? () => wrappedDispatch({ type: 'RESET' }) : undefined} pause={pause} resume={resume} onRefreshTemplates={(t) => setTemplates(withPin(t))}>
        {licensingEnabled(config) && isExpired ? <ExpiredScreen /> : screen}
      </GlassShell>
    </InactivityReset>
  )
}

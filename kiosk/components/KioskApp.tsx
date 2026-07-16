'use client'
import { useReducer, useRef, useEffect, useState, useCallback } from 'react'
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
import { FaceAssignScreen } from '@/components/screens/FaceAssignScreen'
import { MultiCaptureScreen } from '@/components/screens/MultiCaptureScreen'
import { ProcessingScreen } from '@/components/screens/ProcessingScreen'
import { ResultChooserScreen } from '@/components/screens/ResultChooserScreen'
import { PreviewScreen } from '@/components/screens/PreviewScreen'
import { ExpiredScreen } from '@/components/screens/ExpiredScreen'
import { ConsentScreen } from '@/components/screens/ConsentScreen'
import type { ComfyCfg } from '@/lib/comfy'
import type { KioskConfig, KioskState } from '@/lib/types'
import { SPINDONESIA_CATEGORY } from '@/lib/spindonesia-category'
import { useOrientedFrames } from '@/lib/frames'

const SCREEN_ORDER: KioskState['screen'][] = [
  'idle', 'consent', 'liveview', 'category', 'template', 'multicapture', 'faceassign', 'processing', 'resultchooser', 'framechooser', 'preview',
]

const DUMMY_TEMPLATE = { id: 'd1', name: 'Template 1', category: 'faceswap', token_cost: 1, thumbnail_url: null, gender_filter: 'ALL' as const, engine_type: 'faceswap' as const, positive_prompt: null, negative_prompt: null, api_endpoint: null, video_endpoint: null, video_positive_prompt: null, video_negative_prompt: null }
const DUMMY_PRINT_TEMPLATE = { ...DUMMY_TEMPLATE, id: 'p1', name: 'Layout 1', engine_type: 'print' as const, token_cost: 0, shot_count: 4, print_size: '4R' as const, overlay_url: null }

const SCREEN_INIT: Partial<Record<KioskState['screen'], KioskState>> = {
  idle:       { screen: 'idle' },
  consent:    { screen: 'consent' },
  liveview:   { screen: 'liveview' },
  category:   { screen: 'category', imageUrl: '' },
  template:   { screen: 'template', imageUrl: '', category: 'cat-1', selected: [] },
  faceassign: {
    screen: 'faceassign', imageUrl: '', category: 'cat-1', templates: [DUMMY_TEMPLATE],
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
  multicapture: { screen: 'multicapture', template: DUMMY_PRINT_TEMPLATE, shots: [] },
  processing: { screen: 'processing', progress: 0, step: 1, imageUrl: '', templates: [DUMMY_TEMPLATE], assignments: {} },
  resultchooser: { screen: 'resultchooser', imageUrl: '', results: [
    { templateId: 'd1', aiUrl: '/photo-1488426862026-3ee34a7d66df.jpg', originalUrl: '', sourceUrl: '' },
    { templateId: 'd2', aiUrl: '/photo-1488426862026-3ee34a7d66df.jpg', originalUrl: '', sourceUrl: '' },
  ] },
  framechooser: { screen: 'framechooser', aiUrl: '', originalUrl: '' },
  preview:    { screen: 'preview', aiUrl: '', originalUrl: '', selectedFrame: null },
}

function getInitialState(): KioskState {
  // Always return initialState for SSR — client syncs from hash in useEffect
  return initialState
}

// ponytail: licensing active only when server sends remaining_sec > 0
const licensingEnabled = (cfg: KioskConfig) =>
  typeof cfg.remaining_sec === 'number' && cfg.remaining_sec > 0

export function KioskApp({ config: initialConfig }: { config: KioskConfig }) {
  const [state, dispatch] = useReducer(kioskReducer, undefined, getInitialState)
  // Reactive config — Settings save (via GlassShell onConfigChange) meng-update di sini juga,
  // jadi screen (max_templates, magic catcher, dll) langsung berubah TANPA reload halaman.
  const [config, setConfig] = useState(initialConfig)
  // config.templates sudah di-prepend spindonesia (cloud, pinned) di fetchKioskConfig.
  // Simpan subset spindonesia biar pas Settings re-fetch (PB lokal only) tetep di-prepend.
  const spindonesiaPinned = useRef(config.templates.filter(t => t.category === SPINDONESIA_CATEGORY))
  const withPin = (list: KioskConfig['templates']) =>
    [...spindonesiaPinned.current, ...list.filter(t => t.category !== SPINDONESIA_CATEGORY)]
  // Refetch dari Settings bypass filter server (kiosk-config) — saring lagi di sini:
  // FULLBODY (LOCAL) = dunia comfy only, PRINT = dunia print only (spindonesia IKUT kesaring —
  // flow-nya kebalik: print pilih layout dulu), mode lain = non-comfy non-print.
  const modeFilter = (list: KioskConfig['templates']) =>
    config.engine_mode === 'print_local'
      ? list.filter(t => t.engine_type === 'print')
      : list.filter(t =>
          t.category === SPINDONESIA_CATEGORY ||
          (config.engine_mode === 'fullbody_local' ? t.engine_type === 'comfy' : t.engine_type !== 'comfy' && t.engine_type !== 'print'))
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

  const log = useCallback((event_type: string, metadata: Record<string, unknown> = {}) =>
    logVisitorEvent(event_type, { visitor_id: visitorId.current, event_name: config.event_name, ...metadata }, secret.current), [config.event_name])

  // useCallback: identity stabil antar re-render countdown billing (1 Hz di sesi berbayar).
  // Tanpa ini, timer InactivityReset (dep: dispatch) ke-restart tiap detik → failsafe mati,
  // dan effect di screen yang key ke dispatch ke-cancel terus.
  const wrappedDispatch: typeof dispatch = useCallback((rawAction) => {
    // Photo Print: consent langsung ke pemilih layout — liveview+category itu flow AI.
    // Rewrite di sini (bukan di ConsentScreen) karena cuma KioskApp yang pegang config.
    const action = ('type' in rawAction && rawAction.type === 'CONSENT_GIVEN' && config.engine_mode === 'print_local')
      ? { ...rawAction, print: true }
      : rawAction
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
          break
        }
        case 'SELECT_CATEGORY':
          log('VISITOR_CATEGORY_SELECTED', { category: action.category })
          break
        case 'CONFIRM_TEMPLATE': {
          const s = state as Extract<KioskState, { screen: 'template' }>
          // Multi-template: log tiap template kepilih (funnel /analytics gak bolong).
          s.selected.forEach(tmpl => log('VISITOR_TEMPLATE_SELECTED', { template_id: tmpl.id, template_name: tmpl.name }))
          break
        }
        case 'START_CAPTURE_LOOP': {
          // Jalur print skip CONFIRM_TEMPLATE — template-selected tetep ke-log (pola patch comfy).
          if (state.screen === 'template' && state.selected.length > 0)
            log('VISITOR_TEMPLATE_SELECTED', { template_id: state.selected[0].id, template_name: state.selected[0].name })
          break
        }
        case 'SHOT_TAKEN': {
          if (state.screen === 'multicapture')
            log('VISITOR_PHOTO_TAKEN', { shot: state.shots.length + 1, total: state.template.shot_count ?? 4 })
          break
        }
        case 'START_PROCESSING': {
          // Jalur comfy skip FaceAssign (START_PROCESSING langsung dari template) —
          // template-selected tetep ke-log biar funnel /analytics gak bolong. Comfy = single.
          if (state.screen === 'template' && state.selected.length > 0)
            log('VISITOR_TEMPLATE_SELECTED', { template_id: state.selected[0].id, template_name: state.selected[0].name })
          processingStartMs.current = Date.now()
          log('VISITOR_PROCESSING_START')
          break
        }
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
  }, [state, config.engine_mode, log, dispatch])

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

  // Setting engine comfy dari settings.json (FALLBACK ngisi default) — dikonsumsi ProcessingScreen
  const comfyCfg: ComfyCfg = {
    comfy_model_family: config.comfy_model_family,
    comfy_checkpoint: config.comfy_checkpoint,
    comfy_controlnet: config.comfy_controlnet,
    comfy_denoise: config.comfy_denoise,
    comfy_face_lock: config.comfy_face_lock,
    comfy_sampler: config.comfy_sampler,
    comfy_scheduler: config.comfy_scheduler,
  }

  const screen = (() => {
    switch (state.screen) {
      case 'idle':        return <IdleScreen dispatch={wrappedDispatch} />
      case 'consent':     return <ConsentScreen dispatch={wrappedDispatch} />
      case 'liveview':    return <LiveViewScreen state={state} dispatch={wrappedDispatch} />
      case 'category':    return <CategoryScreen state={state} dispatch={wrappedDispatch} templates={templates} />
      // Multi-template cuma faceswap LOCAL (butuh face_server :8000 buat sequential swap).
      // Fullbody (comfy) & faceswap API = selalu single-select.
      case 'template':    return <TemplateScreen state={state} dispatch={wrappedDispatch} templates={templates} maxTemplates={config.engine_mode === 'faceswap_local' ? (config.max_templates ?? 1) : 1} />
      case 'faceassign':  return <FaceAssignScreen state={state} dispatch={wrappedDispatch} />
      case 'multicapture': return <MultiCaptureScreen state={state} dispatch={wrappedDispatch} />
      case 'processing':  return <ProcessingScreen state={state} dispatch={wrappedDispatch} generationSource={config.generation_source} eventName={config.event_name} licensed={config.licensed ?? false} comfy={comfyCfg} enableMagicCatcher={config.enable_magic_catcher ?? false} enableVideoEngine={config.enable_video_engine ?? false} videoProvider={config.video_provider ?? 'PIXVERSE'} onUploadFailed={(meta) => log('UPLOAD_FAILED', meta)} />
      case 'resultchooser': return <ResultChooserScreen state={state} dispatch={wrappedDispatch} />
      case 'framechooser': return <PreviewScreen mode="choose" state={state} dispatch={wrappedDispatch} frames={orientedFrames} config={config} licensed={config.licensed ?? false} eventName={config.event_name} onAction={(a) => log('VISITOR_ACTION', { action: a })} />
      case 'preview':     return <PreviewScreen mode="final" state={state} dispatch={wrappedDispatch} frames={orientedFrames} config={config} licensed={config.licensed ?? false} eventName={config.event_name} onAction={(a) => log('VISITOR_ACTION', { action: a })} />
    }
  })()

  return (
    <InactivityReset screen={state.screen} dispatch={wrappedDispatch}>
      <GlassShell screenKey={state.screen} direction={direction.current} config={config} onLogoClick={state.screen !== 'idle' ? () => wrappedDispatch({ type: 'RESET' }) : undefined} pause={pause} resume={resume} onRefreshTemplates={(t) => setTemplates(modeFilter(withPin(t)))} onConfigChange={(updated) => setConfig(c => ({ ...c, ...updated }))}>
        {licensingEnabled(config) && isExpired ? <ExpiredScreen /> : screen}
      </GlassShell>
    </InactivityReset>
  )
}

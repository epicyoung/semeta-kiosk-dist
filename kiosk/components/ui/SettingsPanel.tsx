'use client'
import { useState, useEffect, useRef } from 'react'
import type { KioskConfig, Template, TemplateSource, Locale } from '@/lib/types'
import { fetchPocketBaseTemplates } from '@/lib/pocketbase'
import { useT } from '@/lib/i18n'
import type { Translations } from '@/lib/locales/types'

type TFn = (key: keyof Translations) => Translations[keyof Translations]
type EngineKey = 'faceswap_local' | 'fullbody_local' | 'faceswap_api' | 'fullbody_api'

const ENGINE_OPTS: { value: EngineKey; label: string; soon?: boolean }[] = [
  { value: 'faceswap_local', label: 'Faceswap (LOCAL)' },
  { value: 'fullbody_local', label: 'Fullbody (LOCAL) — soon', soon: true },
  { value: 'faceswap_api',   label: 'Faceswap (API) — soon',  soon: true },
  { value: 'fullbody_api',   label: 'Fullbody (API) — soon',  soon: true },
]
const API_MODEL_OPTS = [
  { value: 'nanobanana2', label: 'Nanobanana 2' },
  { value: 'gptimg2',     label: 'GPT-IMG 2'    },
]
const CAMERA_OPTS = [
  { value: 'webcam', label: 'Webcam (getUserMedia)' },
  { value: 'canon',  label: 'Canon (EOS Utility)'  },
]

// Shared style for the PB action bar (Open Folder / Admin / Sync) — equal touch targets
const pbActionBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  minHeight: 42, padding: '9px 10px', borderRadius: 'var(--radius-glass)',
  border: '1px solid var(--border-dialog)', background: 'rgba(255,255,255,0.07)',
  color: 'rgba(255,255,255,0.8)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-ui)',
  cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.2s',
}

type PbStatus = 'idle' | 'checking' | 'connected' | 'offline'

// Secret input mask: strip separators, uppercase, regroup into 4-char blocks (0000-0000-0000-0000).
// Dash is part of the stored value — Worker matches the string verbatim, so we keep the dashes.
function formatSecret(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 16)
  return clean.replace(/(.{4})(?=.)/g, '$1-')
}

type Props = {
  open: boolean
  onClose: () => void
  config: KioskConfig
  onConfigSaved?: (updated: Partial<KioskConfig>) => void
  pause?: () => void
  resume?: () => void
  onRefreshTemplates?: (templates: Template[]) => void
}

function Section({ title }: { title: string }) {
  return (
    <p style={{ fontSize: 'var(--text-2xs)', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginTop: 28, marginBottom: 4 }}>
      {title}
    </p>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{label}</span>
      {children}
    </div>
  )
}

function Sel({ value, options, onChange }: { value: string; options: { value: string; label: string; soon?: boolean }[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 'var(--radius-glass)', color: '#fff', fontSize: 'var(--text-sm)', padding: '6px 10px',
      fontFamily: 'var(--font-ui)', cursor: 'pointer', outline: 'none', maxWidth: 220,
    }}>
      {options.map(o => <option key={o.value} value={o.value} disabled={o.soon} style={{ background: 'var(--bg)', color: o.soon ? 'rgba(255,255,255,0.3)' : '#fff' }}>{o.label}</option>)}
    </select>
  )
}

function TextInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.13)',
        borderRadius: 'var(--radius-glass)', color: '#fff', fontSize: mono ? 'var(--text-xs)' : 'var(--text-sm)', padding: '7px 12px',
        fontFamily: 'var(--font-ui)',
        outline: 'none', width: 220, textAlign: 'right',
      }}
    />
  )
}

// Label comes from parent so it can be translated; the '—' idle sentinel stays literal.
function StatusBadge({ status, t }: { status: PbStatus; t: TFn }) {
  const map: Record<PbStatus, { dot: string; label: string }> = {
    idle:      { dot: 'rgba(255,255,255,0.2)', label: '—' },
    checking:  { dot: '#f0c040',               label: t('set_badge_checking') as string },
    connected: { dot: '#a3be8c',               label: t('set_badge_connected') as string },
    offline:   { dot: '#ff6b6b',               label: t('set_badge_offline') as string },
  }
  const { dot, label } = map[status]
  return (
    <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-ui)', color: dot }}>{label}</span>
  )
}

export function SettingsPanel({ open, onClose, config, onConfigSaved, pause, resume, onRefreshTemplates }: Props) {
  const t = useT()
  const [locale,          setLocale]          = useState<Locale>(config.locale ?? 'en')
  const [eventName,       setEventName]       = useState(config.event_name || 'Semeta Event')
  const [outputDir,       setOutputDir]       = useState(config.output_dir || 'C:/semeta')
  const [templateSource,  setTemplateSource]  = useState<TemplateSource>(config.template_source ?? 'pocketbase')
  const [pbUrl,           setPbUrl]           = useState(config.pocketbase_url ?? 'http://localhost:8090')
  const [pbStatus,        setPbStatus]        = useState<PbStatus>('idle')
  const [engine,          setEngine]          = useState<EngineKey>((config.engine_mode as EngineKey) || 'faceswap_local')
  const [apiModel,        setApiModel]        = useState(config.api_model || 'nanobanana2')
  const [camera,          setCamera]          = useState(config.camera_source || 'webcam')
  const [logoFile,        setLogoFile]        = useState<File | null>(null)
  const [logoPreview,     setLogoPreview]     = useState<string | null>(null)
  const [bgFile,          setBgFile]          = useState<File | null>(null)
  const [bgPreview,       setBgPreview]       = useState<string | null>(null)
  const [frames,          setFrames]          = useState<{ id: string; url: string; name?: string }[]>([])
  const [framesLoading,   setFramesLoading]   = useState(false)
  const [frameUploading,  setFrameUploading]  = useState(false)
  const [hideBg,          setHideBg]          = useState(false)
  const [solidBgColor,    setSolidBgColor]    = useState('#090135')
  const [secret,          setSecret]          = useState('')
  const [secretSaved,     setSecretSaved]     = useState(false)
  const [secretSaving,    setSecretSaving]    = useState(false)
  const [secretEditing,   setSecretEditing]   = useState(false)
  const [secretRevealed,  setSecretRevealed]  = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [error,           setError]           = useState<string | null>(null)
  const [sessionPaused,   setSessionPaused]   = useState(false)
  const [resumeError,     setResumeError]     = useState(false)
  const [remainSec,       setRemainSec]       = useState(config.remaining_sec ?? 0)
  const [pauseQuotaSec,   setPauseQuotaSec]   = useState(config.pause_quota_sec ?? 0)
  const [pauseUsedSec,    setPauseUsedSec]    = useState(config.pause_used_sec ?? 0)
  // Track live pause duration within this panel session — resets on resume
  const pauseStartRef = useRef<number | null>(null)
  const [fetchStatus,     setFetchStatus]     = useState<'idle'|'fetching'|'ok'|'err'>('idle')
  const [fetchSummary,    setFetchSummary]    = useState<string | null>(null)
  const [fetchSkipped,    setFetchSkipped]    = useState<{ name: string; reason: string }[]>([])
  const [engineStatus,    setEngineStatus]    = useState<PbStatus>('idle')
  const [cameraStatus,    setCameraStatus]    = useState<PbStatus>('idle')
  const [pbCreds,         setPbCreds]         = useState<{ email: string; password: string } | null>(null)
  // Update: idle → checking → available/uptodate → pulling → ok/err. Mirrors fetchStatus.
  const [updateState,     setUpdateState]     = useState<'idle'|'checking'|'available'|'uptodate'|'pulling'|'ok'|'err'>('idle')
  const [version,         setVersion]         = useState<{ current: string | null; isGit: boolean }>({ current: null, isGit: true })
  const isApi = engine.endsWith('_api')
  // Unlimited = god key (bypassed) ATAU sentinel 365d dari Worker (admin toggle unlimited).
  // ponytail: >300d = unlimited — rental nyata max jam/hari. Ceiling: kalau nanti ada rental >300d
  // beneran, kirim flag `unlimited` eksplisit dari Worker handshake, jangan naikin angka ini.
  const UNLIMITED_SEC = 86400 * 300
  const isUnlimited = (config.bypassed ?? false) || remainSec >= UNLIMITED_SEC || pauseQuotaSec >= UNLIMITED_SEC

  // Language dropdown = instant preview: push locale up so LocaleProvider re-renders the panel
  // in the new language right away. Save still persists it to disk in handleDone.
  const handleLocaleChange = (v: Locale) => {
    setLocale(v)
    onConfigSaved?.({ locale: v })
  }

  useEffect(() => {
    fetch('/api/pb-credentials').then(r => r.json()).then(setPbCreds).catch(() => null)
  }, [])

  // Live countdown — tick every second while panel open + not paused
  useEffect(() => {
    setRemainSec(config.remaining_sec ?? 0)
  }, [config.remaining_sec])

  useEffect(() => {
    if (!open || sessionPaused) return
    const id = setInterval(() => setRemainSec(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [open, sessionPaused])

  // Sync pause quota from config (from heartbeat refill)
  useEffect(() => {
    if (config.pause_quota_sec != null) setPauseQuotaSec(config.pause_quota_sec)
    if (config.pause_used_sec != null) setPauseUsedSec(config.pause_used_sec)
  }, [config.pause_quota_sec, config.pause_used_sec])

  // Live pause quota countdown — tick while panel open + session paused
  useEffect(() => {
    if (!open || !sessionPaused) return
    const id = setInterval(() => setPauseUsedSec(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [open, sessionPaused])

  // Auto-resume saat kuota jeda habis — local-first, server fire-and-forget
  useEffect(() => {
    if (!sessionPaused || pauseQuotaSec === 0 || pauseUsedSec < pauseQuotaSec) return
    resume?.()
    setSessionPaused(false)
    pauseStartRef.current = null
    fetch('/api/session-resume', { method: 'POST' }).catch(() => {})
  }, [sessionPaused, pauseUsedSec, pauseQuotaSec, resume])

  // Ping face_server :8000 when panel opens or engine changes (local only)
  useEffect(() => {
    if (!open || isApi) { setEngineStatus('idle'); return }
    const ctrl = new AbortController()
    setEngineStatus('checking')
    fetch('http://localhost:8000/health', { signal: ctrl.signal, cache: 'no-store' })
      .then(r => { if (!ctrl.signal.aborted) setEngineStatus(r.ok ? 'connected' : 'offline') })
      .catch(() => { if (!ctrl.signal.aborted) setEngineStatus('offline') })
    return () => ctrl.abort()
  }, [open, engine, isApi])

  // Ping digiCamControl :5513 when panel opens or camera changes (canon only)
  useEffect(() => {
    if (!open || camera !== 'canon') { setCameraStatus('idle'); return }
    const ctrl = new AbortController()
    setCameraStatus('checking')
    fetch('http://localhost:5513/', { signal: ctrl.signal, cache: 'no-store' })
      .then(() => { if (!ctrl.signal.aborted) setCameraStatus('connected') })
      .catch(() => { if (!ctrl.signal.aborted) setCameraStatus('offline') })
    return () => ctrl.abort()
  }, [open, camera])

  // Load frames from PocketBase when panel opens
  useEffect(() => {
    if (!open) return
    setFramesLoading(true)
    fetch(`${pbUrl}/api/collections/frames/records?sort=sort_order&perPage=10`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { items: [] })
      .then(data => {
        const items = (data.items ?? []) as Record<string, unknown>[]
        setFrames(items.map(r => ({
          id: String(r.id),
          name: r.name ? String(r.name) : undefined,
          url: r.image ? `${pbUrl}/api/files/frames/${r.id}/${r.image}` : '',
        })).filter(f => f.url))
      })
      .catch(() => {})
      .finally(() => setFramesLoading(false))
  }, [open, pbUrl])

  const handleFrameUpload = async (file: File) => {
    if (frames.length >= 10) return
    setFrameUploading(true)
    try {
      const fd = new FormData()
      fd.append('image', file)
      fd.append('name', file.name.replace(/\.[^.]+$/, ''))
      fd.append('is_active', 'true')
      fd.append('sort_order', String(frames.length + 1))
      const res = await fetch(`${pbUrl}/api/collections/frames/records`, { method: 'POST', body: fd })
      if (res.ok) {
        const r = await res.json() as Record<string, unknown>
        setFrames(prev => [...prev, {
          id: String(r.id),
          name: r.name ? String(r.name) : undefined,
          url: `${pbUrl}/api/files/frames/${r.id}/${r.image}`,
        }])
      }
    } finally {
      setFrameUploading(false)
    }
  }

  const handleFrameDelete = async (id: string) => {
    await fetch(`${pbUrl}/api/collections/frames/records/${id}`, { method: 'DELETE' })
    setFrames(prev => prev.filter(f => f.id !== id))
  }

  // Drag-to-reorder (mouse only — native HTML5 DnD doesn't fire on touch).
  const dragIndex = useRef<number | null>(null)
  const dragSnapshot = useRef<typeof frames | null>(null) // pre-drag order, for rollback on PATCH failure
  const [dragging, setDragging] = useState<number | null>(null)

  // Reorder locally while dragging over a new slot; PATCH sort_order on drop.
  const reorderFrame = (from: number, to: number) => {
    if (from === to) return
    setFrames(prev => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    dragIndex.current = to
    setDragging(to)
  }

  // Persist final order: PATCH each frame's sort_order to match its slot (1-based).
  // On any failure, restore the pre-drag order so PB and UI stay consistent.
  // `order` is passed in from the drop handler — reading `frames` here would be a stale closure.
  // ponytail: PATCH each moved frame individually — batch endpoint if the list ever grows past ~50
  const persistOrder = async (order: typeof frames, snapshot: typeof frames) => {
    try {
      await Promise.all(
        order.map((f, i) =>
          fetch(`${pbUrl}/api/collections/frames/records/${f.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_order: i + 1 }),
          }).then(r => { if (!r.ok) throw new Error('patch failed') })
        )
      )
    } catch {
      setFrames(snapshot)
    }
  }

  // Ping PocketBase when panel opens or URL changes
  useEffect(() => {
    if (!open || templateSource !== 'pocketbase') return
    const ctrl = new AbortController()
    setPbStatus('checking')
    fetch(`${pbUrl}/api/health`, { signal: ctrl.signal, cache: 'no-store' })
      .then(r => { if (!ctrl.signal.aborted) setPbStatus(r.ok ? 'connected' : 'offline') })
      .catch(() => { if (!ctrl.signal.aborted) setPbStatus('offline') })
    return () => ctrl.abort()
  }, [open, pbUrl, templateSource])

  function toDataUrl(file: File): Promise<string> {
    return new Promise((res, rej) => {
      const reader = new FileReader()
      reader.onload = e => res(e.target!.result as string)
      reader.onerror = () => rej(new Error('read failed'))
      reader.readAsDataURL(file)
    })
  }

  const toggleHideBg = (on: boolean) => {
    setHideBg(on)
    document.body.classList.toggle('hide-bg', on)
    if (on) document.documentElement.style.setProperty('--solid-bg', solidBgColor)
  }

  const applySolidBg = (color: string) => {
    setSolidBgColor(color)
    document.documentElement.style.setProperty('--solid-bg', color)
  }

  const handleFetchTemplates = async () => {
    setFetchStatus('fetching')
    setFetchSummary(null)
    setFetchSkipped([])
    try {
      // 1. Sync folder put-template-here/ → PocketBase (crop 2:3, tambah baru, hapus yang sudah tidak ada)
      const syncRes = await fetch('/api/sync-templates', { method: 'POST' })
      if (!syncRes.ok) { setFetchStatus('err'); setTimeout(() => setFetchStatus('idle'), 2500); return }
      const d = await syncRes.json() as {
        added: number; cropped: number; deleted: number
        detectDown: boolean; skipped: { name: string; reason: string }[]
      }
      // 2. Fetch hasil terbaru dari PocketBase → kiosk (0 template = valid, bukan error)
      const results = await fetchPocketBaseTemplates(pbUrl)
      onRefreshTemplates?.(results)
      // 3. Ringkas hasil biar gak sukses-palsu (dulu "fetched" walau semua ke-skip)
      const parts = [`${d.added} masuk`]
      if (d.cropped) parts.push(`${d.cropped} di-crop`)
      if (d.deleted) parts.push(`${d.deleted} dihapus`)
      if (d.skipped.length) parts.push(`${d.skipped.length} di-skip`)
      if (d.detectDown) parts.push('face_server mati (crop pakai center)')
      setFetchSummary(parts.join(' · '))
      setFetchSkipped(d.skipped)
      setFetchStatus('ok')
    } catch {
      setFetchStatus('err')
    }
    setTimeout(() => setFetchStatus('idle'), 2500)
  }

  // Load local version when panel opens (cheap, no network)
  useEffect(() => {
    if (!open) return
    fetch('/api/update')
      .then(r => r.json())
      .then((d: { current: string | null; isGit: boolean }) => setVersion({ current: d.current, isGit: d.isGit }))
      .catch(() => {})
  }, [open])

  const handleCheckUpdate = async () => {
    setUpdateState('checking')
    try {
      const res = await fetch('/api/update', { cache: 'no-store' })
      const d = await res.json() as { hasUpdate: boolean; current: string | null; isGit: boolean }
      setVersion({ current: d.current, isGit: d.isGit })
      setUpdateState(d.hasUpdate ? 'available' : 'uptodate')
      if (!d.hasUpdate) setTimeout(() => setUpdateState('idle'), 2500)
    } catch {
      setUpdateState('err')
      setTimeout(() => setUpdateState('idle'), 2500)
    }
  }

  const handlePullUpdate = async () => {
    setUpdateState('pulling')
    try {
      const res = await fetch('/api/update', { method: 'POST' })
      const d = await res.json() as { ok: boolean; to?: string | null }
      if (d.ok) {
        if (d.to) setVersion(v => ({ ...v, current: d.to! }))
        setUpdateState('ok') // stays 'ok' — restart note shows until panel closes
      } else {
        setUpdateState('err')
        setTimeout(() => setUpdateState('idle'), 3500)
      }
    } catch {
      setUpdateState('err')
      setTimeout(() => setUpdateState('idle'), 3500)
    }
  }

  const handleSaveSecret = async () => {
    if (!secret.trim()) return
    setSecretSaving(true)
    setSecretSaved(false)
    try {
      const res = await fetch('/api/save-secret', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secret.trim() }),
      })
      if (res.ok) {
        setSecretSaved(true)
        onConfigSaved?.({ has_secret: true, secret_hint: secret.trim() })
        setSecret('')
        setTimeout(() => setSecretSaved(false), 4000)
      }
    } finally {
      setSecretSaving(false)
    }
  }

  const handlePause = async () => {
    pause?.()
    pauseStartRef.current = Date.now()
    setSessionPaused(true)
    setResumeError(false)
    fetch('/api/session-pause', { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.pause_quota_sec != null) { setPauseQuotaSec(d.pause_quota_sec); setPauseUsedSec(d.pause_used_sec ?? 0) } })
      .catch(() => {})
  }

  const handleResume = async () => {
    if (!navigator.onLine) { setResumeError(true); return }
    setResumeError(false)
    try {
      const res = await fetch('/api/session-resume', { method: 'POST' })
      if (res.ok) {
        const d = await res.json().catch(() => ({}))
        if (d?.pause_quota_sec != null) { setPauseQuotaSec(d.pause_quota_sec); setPauseUsedSec(d.pause_used_sec ?? 0) }
        pauseStartRef.current = null
        resume?.()
        setSessionPaused(false)
      }
    } catch {
      setResumeError(true)
    }
  }

  const handleDone = async () => {
    setSaving(true)
    setError(null)
    try {
      let logo_url: string | undefined
      let bg_url: string | undefined
      if (logoFile) logo_url = await toDataUrl(logoFile)
      if (bgFile)   bg_url   = await toDataUrl(bgFile)

      const patch: Record<string, unknown> = {
        event_name:        eventName,
        engine_mode:       engine,
        generation_source: engine.endsWith('_local') ? 'LOCAL' : 'fal',
        camera_source:     camera,
        api_model:         apiModel,
        template_source:   templateSource,
        pocketbase_url:    pbUrl,
        output_dir:        outputDir,
        locale,
      }
      if (logo_url) patch.logo_url = logo_url
      if (bg_url)   patch.bg_url   = bg_url

      const res = await fetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error('Save failed')

      onConfigSaved?.({
        event_name:        eventName,
        engine_mode:       engine,
        generation_source: engine.endsWith('_local') ? 'LOCAL' : 'fal',
        camera_source:     camera,
        api_model:         apiModel,
        template_source:   templateSource,
        pocketbase_url:    pbUrl,
        output_dir:        outputDir,
        locale,
        ...(logo_url ? { logo_url } : {}),
        ...(bg_url   ? { bg_url   } : {}),
      } as Partial<KioskConfig>)
      onClose()
    } catch {
      setError(t('set_save_error') as string)
    } finally {
      setSaving(false)
    }
  }

  // Unmount fully when closed so no settings, PB URL, or admin credentials
  // linger in the DOM / accessibility tree. All hooks above already run
  // unconditionally, so this early return is safe.
  if (!open) return null

  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.15)' }} />

      <div style={{
        position: 'absolute', inset: 0, zIndex: 41,
        background: 'rgba(9,1,53,0.97)', backdropFilter: 'blur(32px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 32px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: '#fff', letterSpacing: '-0.02em' }}>{t('set_header') as string}</span>
          <button onClick={onClose} aria-label={t('set_close_aria') as string} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 'var(--text-lg)', lineHeight: 1, padding: '6px 12px', borderRadius: 'var(--radius-glass)' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 32px 32px', scrollbarWidth: 'thin', scrollbarColor: 'var(--brand) transparent' }}>
          <div style={{ maxWidth: 680, margin: '0 auto' }}>

            {/* LISENSI */}
            <Section title={t('set_sec_license') as string} />
            <div style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_secret_label') as string}</span>
                  <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0' }}>
                    {config.has_secret ? t('set_secret_installed') as string : t('set_secret_empty_hint') as string}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Refresh: licensed & remaining_sec cuma dibaca pas page load (checkLicenseGate server).
                      Reload = re-handshake ke Worker → status admin kepick instan tanpa restart manual. */}
                  <button
                    onClick={() => window.location.reload()}
                    aria-label="Refresh license from server"
                    title="Re-check rental & license"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 'var(--radius-glass)', color: 'rgba(255,255,255,0.65)', cursor: 'pointer', fontSize: 'var(--text-sm)', lineHeight: 1, padding: '5px 9px' }}
                  >↻</button>
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: isUnlimited ? 700 : 400, letterSpacing: isUnlimited ? '0.06em' : undefined, fontFamily: 'var(--font-ui)', color: isUnlimited ? '#f0c040' : config.licensed ? '#a3be8c' : config.has_secret ? '#f0c040' : 'rgba(255,255,255,0.3)' }}>
                    {isUnlimited ? '⚡ GODMODE' : config.licensed ? t('set_secret_state_active') as string : config.has_secret ? t('set_secret_state_expired') as string : '—'}
                  </span>
                </div>
              </div>
              {!secretEditing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                  <span style={{
                    flex: 1, background: config.bypassed ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.06)',
                    border: config.bypassed ? '1px solid rgba(124,58,237,0.4)' : '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 'var(--radius-glass)',
                    color: config.bypassed ? '#a78bfa' : 'rgba(255,255,255,0.5)',
                    fontSize: config.bypassed ? 'var(--text-xs)' : 'var(--text-sm)',
                    fontWeight: config.bypassed ? 700 : 400,
                    padding: '9px 12px',
                    fontFamily: 'var(--font-ui)', letterSpacing: config.bypassed ? '0.2em' : '0.12em', userSelect: 'none',
                  }}>
                    {config.bypassed
                      ? '⚡ GOD MODE'
                      : config.has_secret && config.secret_hint
                        ? secretRevealed
                          ? config.secret_hint
                          : (h => h.length > 4 ? h.slice(0, -4).replace(/[^-]/g, '*') + h.slice(-4) : h.replace(/./g, '*'))(config.secret_hint)
                        : t('set_secret_placeholder_empty') as string}
                  </span>
                  {config.has_secret && config.secret_hint && (
                    <button
                      onMouseDown={() => setSecretRevealed(true)}
                      onMouseUp={() => setSecretRevealed(false)}
                      onMouseLeave={() => setSecretRevealed(false)}
                      onTouchStart={() => setSecretRevealed(true)}
                      onTouchEnd={() => setSecretRevealed(false)}
                      title={t('set_secret_hold_reveal') as string}
                      style={{
                        padding: '8px 10px', borderRadius: 'var(--radius-glass)', border: '1px solid rgba(255,255,255,0.15)',
                        background: secretRevealed ? 'rgba(124,58,237,0.2)' : 'transparent',
                        color: secretRevealed ? '#a78bfa' : 'rgba(255,255,255,0.4)',
                        fontSize: 'var(--text-base)', cursor: 'pointer', lineHeight: 1, userSelect: 'none',
                      }}
                    >
                      {secretRevealed ? '🙈' : '👁'}
                    </button>
                  )}
                  <button onClick={() => { setSecret(''); setSecretEditing(true); setSecretSaved(false); }} style={{
                    padding: '8px 16px', borderRadius: 'var(--radius-glass)', border: '1px solid rgba(255,255,255,0.15)',
                    background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--font-ui)', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>
                    {t('set_secret_change') as string}
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <input
                      autoFocus
                      value={secret}
                      onChange={e => setSecret(formatSecret(e.target.value))}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveSecret(); if (e.key === 'Escape') setSecretEditing(false); }}
                      placeholder="0000-0000-0000-0000"
                      inputMode="text"
                      maxLength={19}
                      style={{
                        flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.13)',
                        borderRadius: 'var(--radius-glass)', color: '#fff', fontSize: 'var(--text-sm)', padding: '9px 12px',
                        fontFamily: 'var(--font-ui)', letterSpacing: '0.05em', outline: 'none',
                      }}
                    />
                    <button onClick={async () => { await handleSaveSecret(); setSecretEditing(false); }} disabled={secretSaving || !secret.trim()} style={{
                      padding: '0 18px', borderRadius: 'var(--radius-glass)', border: 'none',
                      background: secretSaved ? 'rgba(163,190,140,0.25)' : 'var(--brand)',
                      color: secretSaved ? '#a3be8c' : '#fff', fontSize: 'var(--text-sm)', fontWeight: 600,
                      fontFamily: 'var(--font-ui)', cursor: secretSaving || !secret.trim() ? 'default' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}>
                      {secretSaving ? '…' : secretSaved ? t('set_secret_saved') as string : t('set_secret_save') as string}
                    </button>
                    <button onClick={() => setSecretEditing(false)} style={{
                      padding: '0 12px', borderRadius: 'var(--radius-glass)', border: '1px solid rgba(255,255,255,0.15)',
                      background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 'var(--text-xs)',
                      fontFamily: 'var(--font-ui)', cursor: 'pointer',
                    }}>
                      {t('set_secret_cancel') as string}
                    </button>
                  </div>
                  {secretSaved && (
                    <p style={{ fontSize: 'var(--text-2xs)', color: '#a3be8c', margin: '8px 0 0' }}>
                      {t('set_secret_saved_note') as string}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Timer + Pause — di bawah secret biar Budi bisa pantau sekalian */}
            {(pause || resume) && (
              <Row label={t('set_time_remaining') as string}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {isUnlimited ? (
                    <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'calc(var(--text-lg) * 1.3)', fontWeight: 800, lineHeight: 1, color: '#a3be8c' }} title="Unlimited">∞</span>
                  ) : (
                    <span style={{
                      fontFamily: 'var(--font-ui)', fontSize: 'var(--text-lg)', fontWeight: 600, letterSpacing: '0.05em',
                      color: remainSec > 600 ? '#a3be8c' : remainSec > 0 ? '#f0c040' : 'rgba(255,255,255,0.25)',
                    }}>
                      {String(Math.floor(remainSec / 3600)).padStart(2, '0')}
                      :{String(Math.floor((remainSec % 3600) / 60)).padStart(2, '0')}
                      :{String(remainSec % 60).padStart(2, '0')}
                    </span>
                  )}
                  {sessionPaused ? (
                    <button onClick={handleResume} disabled={!navigator.onLine} style={{
                      padding: '6px 16px', borderRadius: 'var(--radius-glass)', border: 'none', cursor: navigator.onLine ? 'pointer' : 'default',
                      background: navigator.onLine ? '#a3e635' : 'rgba(255,255,255,0.1)',
                      color: navigator.onLine ? 'var(--bg)' : 'rgba(255,255,255,0.4)', fontWeight: 600, fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)',
                    }}>
                      {navigator.onLine ? t('set_resume') as string : t('set_resume_need_conn') as string}
                    </button>
                  ) : pauseQuotaSec > 0 && pauseUsedSec >= pauseQuotaSec ? (
                    <span style={{ fontSize: 'var(--text-xs)', color: '#ff6b6b', fontFamily: 'var(--font-ui)' }}>
                      {t('set_pause_disabled') as string}
                    </span>
                  ) : (
                    <button onClick={handlePause} style={{
                      padding: '6px 16px', borderRadius: 'var(--radius-glass)', border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.8)',
                      fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)', cursor: 'pointer',
                    }}>
                      {t('set_pause') as string}
                    </button>
                  )}
                </div>
              </Row>
            )}
            {resumeError && (
              <p style={{ fontSize: 'var(--text-xs)', color: '#ff6b6b', margin: '-8px 0 8px' }}>
                {t('set_resume_failed') as string}
              </p>
            )}

            {/* Kuota Jeda — only show when pause quota exists */}
            {pauseQuotaSec > 0 && (
              <div style={{ padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {(() => {
                  const remaining = Math.max(0, pauseQuotaSec - pauseUsedSec)
                  const pct = Math.min(1, pauseUsedSec / pauseQuotaSec)
                  const isExhausted = remaining === 0
                  const isLow = !isExhausted && pct >= 0.8
                  const barColor = isExhausted ? '#ff6b6b' : isLow ? '#f0c040' : '#a3be8c'
                  const hh = String(Math.floor(remaining / 3600)).padStart(2, '0')
                  const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, '0')
                  const ss = String(remaining % 60).padStart(2, '0')
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div>
                          <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_pause_quota') as string}</span>
                          <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0' }}>
                            {t('set_pause_quota_hint') as string}
                          </p>
                        </div>
                        {isUnlimited ? (
                          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'calc(var(--text-base) * 1.4)', fontWeight: 800, lineHeight: 1, color: 'rgba(255,255,255,0.75)' }} title="Unlimited">∞</span>
                        ) : (
                          <span style={{
                            fontFamily: 'var(--font-ui)', fontSize: 'var(--text-base)', fontWeight: 600, letterSpacing: '0.04em',
                            color: isExhausted ? '#ff6b6b' : isLow ? '#f0c040' : 'rgba(255,255,255,0.6)',
                          }}>
                            {isExhausted ? t('set_pause_quota_exhausted_badge') as string : `${hh}:${mm}:${ss}`}
                          </span>
                        )}
                      </div>
                      {/* Progress bar — unlimited → RGB shimmer penuh, else fill sesuai pct */}
                      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                        {isUnlimited ? (
                          <>
                            {/* inline gradient+keyframe — ga gantung ke globals.css yang suka ga hot-reload */}
                            <style>{`@keyframes rgb-flow{to{background-position:200% 50%}}@media(prefers-reduced-motion:reduce){.rgb-bar{animation:none!important}}`}</style>
                            <div className="rgb-bar" style={{
                              height: '100%', width: '100%', borderRadius: 2,
                              backgroundImage: 'linear-gradient(90deg,#ff5d5d,#f5c542,#7cff6b,#38e0ff,#a97bff,#ff5d5d)',
                              backgroundSize: '200% 100%',
                              animation: 'rgb-flow 2.4s linear infinite',
                            }} />
                          </>
                        ) : (
                          <div style={{
                            height: '100%', borderRadius: 2,
                            width: `${Math.round(pct * 100)}%`,
                            background: barColor,
                            transition: 'width 1s linear, background 0.3s',
                          }} />
                        )}
                      </div>
                      {!isUnlimited && isExhausted && (
                        <p style={{ fontSize: 'var(--text-2xs)', color: '#ff6b6b', margin: '6px 0 0' }}>
                          {t('set_pause_quota_exhausted_note') as string}
                        </p>
                      )}
                      {!isUnlimited && isLow && !isExhausted && (
                        <p style={{ fontSize: 'var(--text-2xs)', color: '#f0c040', margin: '6px 0 0' }}>
                          {t('set_pause_quota_low_note') as string}
                        </p>
                      )}
                    </>
                  )
                })()}
              </div>
            )}

            {/* IDENTITAS KIOSK — read-only, dari DB */}
            <Section title={t('set_sec_identity') as string} />
            <Row label={t('set_kiosk_name') as string}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-ui)' }}>
                {config.kiosk_name ?? '—'}
              </span>
            </Row>
            <Row label={t('set_kiosk_no') as string}>
              <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)', color: 'rgba(255,255,255,0.5)' }}>
                {config.kiosk_no != null ? `#${config.kiosk_no}` : '—'}
              </span>
            </Row>

            {/* EVENT */}
            <Section title={t('set_sec_event') as string} />
            <Row label={t('set_event_name') as string}>
              <TextInput value={eventName} onChange={setEventName} />
            </Row>

            {/* LANGUAGE */}
            <Section title={t('set_sec_language') as string} />
            <div style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_display_language') as string}</span>
                <Sel
                  value={locale}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'id', label: 'Bahasa Indonesia' },
                    { value: 'ko', label: '한국어' },
                    { value: 'ja', label: '日本語' },
                    { value: 'nl', label: 'Nederlands' },
                    { value: 'zh', label: '简体中文' },
                    { value: 'ar', label: 'العربية' },
                    { value: 'myth-en', label: 'Dark Myth (EN)' },
                    { value: 'myth-id', label: 'Dark Myth (ID)' },
                  ]}
                  onChange={v => handleLocaleChange(v as Locale)}
                />
              </div>
            </div>

            {/* OUTPUT */}
            <Section title={t('set_sec_output') as string} />
            <Row label={t('set_folder') as string}>
              <TextInput value={outputDir} onChange={setOutputDir} placeholder="C:/semeta" mono />
            </Row>
            <div style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_pb_data') as string}</span>
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-ui)', color: 'rgba(255,255,255,0.3)' }}>C:/semeta/pb/pb_data/</span>
              </div>
              <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.25)', margin: '4px 0 0' }}>{t('set_pb_data_note') as string}</p>
            </div>

            {/* TEMPLATES */}
            <Section title={t('set_sec_templates') as string} />
            <Row label={t('set_source') as string}>
              <Sel
                value={templateSource}
                options={[
                  { value: 'pocketbase', label: 'Epicyoung PB (localhost)' },
                ]}
                onChange={v => setTemplateSource(v as TemplateSource)}
              />
            </Row>
            {templateSource === 'pocketbase' && (
              <>
                <Row label={t('set_pb_url') as string}>
                  <TextInput value={pbUrl} onChange={setPbUrl} placeholder="http://localhost:8090" mono />
                </Row>
                <div style={{ padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {/* Status line — matches the Row pattern used elsewhere */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_status') as string}</span>
                    <StatusBadge status={pbStatus} t={t} />
                  </div>

                  {/* Action bar — 3 equal-width touch targets */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
                    <button onClick={() => fetch('/api/open-folder', { method: 'POST' })} style={pbActionBtn}>
                      {t('set_open_folder') as string}
                    </button>
                    <a href={`${pbUrl}/_/`} target="_blank" rel="noopener noreferrer" style={{ ...pbActionBtn, textDecoration: 'none' }}>
                      ↗ Admin
                    </a>
                    <button
                      onClick={handleFetchTemplates}
                      disabled={fetchStatus === 'fetching'}
                      style={{
                        ...pbActionBtn,
                        background: fetchStatus === 'ok' ? 'rgba(163,190,140,0.2)' : fetchStatus === 'err' ? 'rgba(255,107,107,0.2)' : pbActionBtn.background,
                        color: fetchStatus === 'ok' ? '#a3be8c' : fetchStatus === 'err' ? '#ff6b6b' : pbActionBtn.color,
                        cursor: fetchStatus === 'fetching' ? 'default' : 'pointer',
                      }}
                    >
                      {fetchStatus === 'fetching' ? t('set_fetch_loading') as string : fetchStatus === 'ok' ? t('set_fetch_ok') as string : fetchStatus === 'err' ? t('set_fetch_failed') as string : t('set_fetch_idle') as string}
                    </button>
                  </div>

                  {/* PB admin login helper — clearly a labeled key/value, not an accident */}
                  {pbCreds && (pbCreds.email || pbCreds.password) && (
                    <div style={{
                      marginTop: 10, padding: '10px 12px', borderRadius: 'var(--radius-glass)',
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                      display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 14px', alignItems: 'baseline',
                      fontFamily: 'var(--font-ui)', fontSize: 'var(--text-2xs)',
                    }}>
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>user</span>
                      <span style={{ color: 'rgba(255,255,255,0.7)', wordBreak: 'break-all' }}>{pbCreds.email}</span>
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>pass</span>
                      <span style={{ color: 'rgba(255,255,255,0.7)', wordBreak: 'break-all' }}>{pbCreds.password}</span>
                    </div>
                  )}
                </div>
                <div style={{ padding: '10px 0 6px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.28)', margin: 0 }}>
                    {t('set_import_hint_pre') as string} <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4, fontFamily: 'var(--font-ui)' }}>sync</code> {t('set_import_hint_post') as string}
                  </p>
                  <p style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-ui)', color: 'rgba(255,255,255,0.18)', margin: '4px 0 0', wordBreak: 'break-all' }}>
                    kiosk/face_server/put-template-here/
                  </p>
                  {fetchSummary && (
                    <p style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-ui)', color: 'rgba(255,255,255,0.5)', margin: '8px 0 0' }}>
                      {fetchSummary}
                    </p>
                  )}
                  {fetchSkipped.length > 0 && (
                    <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', maxHeight: 120, overflowY: 'auto' }}>
                      {fetchSkipped.map((s, i) => (
                        <li key={i} style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-ui)', color: '#ff8080', wordBreak: 'break-all' }}>
                          ✗ {s.name} — {s.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
            {templateSource === 'json' && (
              <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.28)', marginTop: 6 }}>
                {t('set_json_note') as string}
              </p>
            )}

            {/* SESSION — only show if billing is active (pause/resume props provided) */}

            {/* ENGINE */}
            <Section title={t('set_sec_engine') as string} />
            <Row label={t('set_mode') as string}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {!isApi && <StatusBadge status={engineStatus} t={t} />}
                <Sel value={engine} options={ENGINE_OPTS} onChange={v => setEngine(v as EngineKey)} />
              </div>
            </Row>
            {isApi && (
              <Row label={t('set_api_model') as string}>
                <Sel value={apiModel} options={API_MODEL_OPTS} onChange={setApiModel} />
              </Row>
            )}

            {/* CAMERA */}
            <Section title={t('set_sec_camera') as string} />
            <Row label={t('set_source') as string}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {camera === 'canon' && <StatusBadge status={cameraStatus} t={t} />}
                <Sel value={camera} options={CAMERA_OPTS} onChange={setCamera} />
              </div>
            </Row>

            {/* SYSTEM / UPDATE */}
            <Section title={t('set_sec_system') as string} />
            <div style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_version_label') as string}</span>
                  <p style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-ui)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0' }}>
                    {version.current ?? '—'}
                  </p>
                </div>
                {version.isGit ? (
                  updateState === 'available' || updateState === 'ok' || updateState === 'pulling' ? (
                    <button
                      onClick={handlePullUpdate}
                      disabled={updateState === 'pulling' || updateState === 'ok'}
                      style={{
                        padding: '6px 16px', borderRadius: 'var(--radius-glass)', border: 'none',
                        background: updateState === 'ok' ? 'rgba(163,190,140,0.25)' : 'var(--brand)',
                        color: updateState === 'ok' ? '#a3be8c' : '#fff', fontSize: 'var(--text-sm)', fontWeight: 600,
                        fontFamily: 'var(--font-ui)', cursor: updateState === 'pulling' || updateState === 'ok' ? 'default' : 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      {updateState === 'pulling' ? t('set_update_pulling') as string
                        : updateState === 'ok' ? t('set_update_ok') as string
                        : t('set_update_available') as string}
                    </button>
                  ) : (
                    <button
                      onClick={handleCheckUpdate}
                      disabled={updateState === 'checking'}
                      style={{
                        padding: '6px 16px', borderRadius: 'var(--radius-glass)', border: '1px solid rgba(255,255,255,0.15)',
                        background: updateState === 'uptodate' ? 'rgba(163,190,140,0.15)' : updateState === 'err' ? 'rgba(255,107,107,0.15)' : 'rgba(255,255,255,0.07)',
                        color: updateState === 'uptodate' ? '#a3be8c' : updateState === 'err' ? '#ff6b6b' : 'rgba(255,255,255,0.8)',
                        fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)', cursor: updateState === 'checking' ? 'default' : 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      {updateState === 'checking' ? t('set_update_checking') as string
                        : updateState === 'uptodate' ? t('set_update_uptodate') as string
                        : updateState === 'err' ? t('set_update_failed') as string
                        : t('set_update_check') as string}
                    </button>
                  )
                ) : (
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', maxWidth: 200, textAlign: 'right' }}>
                    {t('set_update_disabled_note') as string}
                  </span>
                )}
              </div>
              {updateState === 'ok' && (
                <p style={{ fontSize: 'var(--text-2xs)', color: '#a3be8c', margin: '8px 0 0' }}>
                  {t('set_update_restart_note') as string}
                </p>
              )}
            </div>

            {/* BRANDING */}
            <Section title={t('set_sec_branding') as string} />

            {/* Logo */}
            <div style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: logoPreview ? 12 : 0 }}>
                <div>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_logo') as string}</span>
                  <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0' }}>{t('set_logo_hint') as string}</p>
                </div>
                <label style={{ cursor: 'pointer' }}>
                  <input type="file" accept="image/png,image/svg+xml,image/webp" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)) } }} />
                  <span style={{ fontSize: 'var(--text-xs)', padding: '6px 14px', borderRadius: 'var(--radius-glass)', border: '1px solid var(--border-dialog)', background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.8)', fontFamily: 'var(--font-ui)' }}>
                    {logoPreview ? t('set_change') as string : t('set_upload') as string}
                  </span>
                </label>
              </div>
              {logoPreview && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                  <img src={logoPreview} alt="logo" style={{ height: 40, maxWidth: 160, objectFit: 'contain', borderRadius: 4, background: 'rgba(255,255,255,0.05)', padding: 4 }} />
                  <button onClick={() => { setLogoFile(null); setLogoPreview(null) }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-ui)' }}>{t('set_remove') as string}</button>
                </div>
              )}
            </div>

            {/* Background */}
            <div style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: bgPreview ? 12 : 0 }}>
                <div>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_bg') as string}</span>
                  <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0' }}>{t('set_bg_hint') as string}</p>
                </div>
                <label style={{ cursor: 'pointer' }}>
                  <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) { setBgFile(f); setBgPreview(URL.createObjectURL(f)) } }} />
                  <span style={{ fontSize: 'var(--text-xs)', padding: '6px 14px', borderRadius: 'var(--radius-glass)', border: '1px solid var(--border-dialog)', background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.8)', fontFamily: 'var(--font-ui)' }}>
                    {bgPreview ? t('set_change') as string : t('set_upload') as string}
                  </span>
                </label>
              </div>
              {bgPreview && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                  <img src={bgPreview} alt="bg" style={{ height: 60, width: 34, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)' }} />
                  <div>
                    <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.5)', margin: 0, fontFamily: 'var(--font-ui)' }}>1080×1920</p>
                    <button onClick={() => { setBgFile(null); setBgPreview(null) }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-ui)', padding: 0, marginTop: 2 }}>{t('set_remove') as string}</button>
                  </div>
                </div>
              )}
            </div>

            {/* Frame Overlays */}
            <div style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_frames') as string}</span>
                  <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0' }}>{t('set_frames_hint') as string}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-ui)', color: 'rgba(255,255,255,0.3)' }}>{frames.length}/10</span>
                  {frames.length < 10 && (
                    <label style={{ cursor: frameUploading ? 'default' : 'pointer' }}>
                      <input type="file" accept="image/png,image/webp" style={{ display: 'none' }}
                        disabled={frameUploading}
                        onChange={e => { const f = e.target.files?.[0]; if (f) { handleFrameUpload(f); e.target.value = '' } }} />
                      <span style={{ fontSize: 'var(--text-xs)', padding: '6px 14px', borderRadius: 'var(--radius-glass)', border: '1px solid var(--border-dialog)', background: frameUploading ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)', color: frameUploading ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)', fontFamily: 'var(--font-ui)' }}>
                        {frameUploading ? '⟳' : `+ ${t('set_upload') as string}`}
                      </span>
                    </label>
                  )}
                </div>
              </div>
              {framesLoading ? (
                <p style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.25)', margin: 0 }}>{t('set_frames_loading') as string}</p>
              ) : frames.length === 0 ? (
                <p style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.2)', margin: 0 }}>{t('set_frames_empty') as string}</p>
              ) : (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {frames.map((f, i) => (
                    <div
                      key={f.id}
                      draggable
                      onDragStart={() => { dragIndex.current = i; setDragging(i); dragSnapshot.current = frames }}
                      onDragOver={e => { e.preventDefault(); if (dragIndex.current !== null) reorderFrame(dragIndex.current, i) }}
                      onDragEnd={() => {
                        const snap = dragSnapshot.current
                        dragIndex.current = null; setDragging(null); dragSnapshot.current = null
                        setFrames(cur => { if (snap) persistOrder(cur, snap); return cur })
                      }}
                      style={{ position: 'relative', width: 52, flexShrink: 0, cursor: 'grab', opacity: dragging === i ? 0.4 : 1, transition: 'opacity 0.15s' }}
                    >
                      <div style={{ width: 52, height: 78, borderRadius: 'var(--radius-chip)', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}>
                        <img src={f.url} alt={f.name ?? 'frame'} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <button
                        onClick={() => handleFrameDelete(f.id)}
                        style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: 'rgba(255,80,80,0.85)', border: 'none', color: '#fff', fontSize: 'var(--text-2xs)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, pointerEvents: dragging === null ? 'auto' : 'none' }}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Background Effects toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: hideBg ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
              <div>
                <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_bg_effects') as string}</span>
                <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0' }}>{t('set_bg_effects_hint') as string}</p>
              </div>
              <button type="button" onClick={() => toggleHideBg(!hideBg)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <div style={{ width: 44, height: 24, borderRadius: 12, background: !hideBg ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.15)', position: 'relative', transition: 'background 0.2s' }}>
                  <div style={{ position: 'absolute', top: 3, left: !hideBg ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
                </div>
              </button>
            </div>

            {hideBg && <Row label={t('set_bg_color') as string}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Swatch — colored div with hidden color input overlaid */}
                <label style={{ position: 'relative', width: 28, height: 28, flexShrink: 0, cursor: 'pointer' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 'var(--radius-chip)', background: solidBgColor, border: '2px solid rgba(255,255,255,0.2)' }} />
                  <input type="color" value={solidBgColor} onChange={e => applySolidBg(e.target.value)}
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                </label>
                <input type="text" value={solidBgColor}
                  onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) applySolidBg(e.target.value) }}
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 'var(--radius-glass)', color: '#fff', fontSize: 'var(--text-xs)', padding: '5px 10px', fontFamily: 'var(--font-ui)', outline: 'none', width: 90 }} />
              </div>
            </Row>}

          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 32px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
            {error && <p style={{ color: '#ff6b6b', fontSize: 'var(--text-xs)', marginBottom: 10, textAlign: 'center' }}>{error}</p>}
            <button onClick={handleDone} disabled={saving} style={{
              width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
              background: saving ? 'rgba(128,25,194,0.5)' : '#8019c2',
              color: '#ffffff', fontSize: 'var(--text-base)', fontWeight: 700,
              fontFamily: 'var(--font-ui)', cursor: saving ? 'default' : 'pointer',
              letterSpacing: '0.02em',
              boxShadow: saving ? 'none' : '0 0 24px rgba(128,25,194,0.45)',
              transition: 'background 0.2s',
            }}>
              {saving ? t('set_saving') as string : t('set_done') as string}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

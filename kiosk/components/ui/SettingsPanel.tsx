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

const pbActionBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  minHeight: 42, padding: '9px 10px', borderRadius: 'var(--radius-glass)',
  border: '1px solid var(--border-dialog)', background: 'rgba(255,255,255,0.07)',
  color: 'rgba(255,255,255,0.8)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-ui)',
  cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.2s',
}

type PbStatus = 'idle' | 'checking' | 'connected' | 'offline'

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

// ── Accordion group ──────────────────────────────────────────────────────────
function AccordionGroup({
  id, icon, title, open, onToggle, children,
}: {
  id: string; icon: string; title: string; open: boolean; onToggle: (id: string) => void; children: React.ReactNode
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => onToggle(id)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '15px 0', background: 'none', border: 'none',
          borderBottom: open ? '1px solid rgba(124,58,237,0.35)' : '1px solid rgba(255,255,255,0.08)',
          cursor: 'pointer', color: '#fff', textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, letterSpacing: '0.01em', color: open ? '#a78bfa' : '#fff' }}>{title}</span>
        </span>
        <span style={{
          fontSize: 11, color: 'rgba(255,255,255,0.35)',
          display: 'inline-block', transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▾</span>
      </button>
      {open && <div style={{ paddingTop: 4 }}>{children}</div>}
    </div>
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

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
      <div style={{ width: 44, height: 24, borderRadius: 12, background: on ? 'var(--brand)' : 'rgba(255,255,255,0.15)', position: 'relative', transition: 'background 0.2s' }}>
        <div style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
      </div>
    </button>
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
  const [locale,          setLocale]          = useState<Locale>(config.locale ?? 'myth-en')
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
  // Auto-verify sesudah simpan secret: re-handshake → hijau/amber/merah, hijau auto-restart.
  const [verify,          setVerify]          = useState<'idle'|'checking'|'valid'|'expired'|'invalid'|'offline'>('idle')
  const [restartIn,       setRestartIn]       = useState<number | null>(null)
  const [saving,          setSaving]          = useState(false)
  const [error,           setError]           = useState<string | null>(null)
  const [sessionPaused,   setSessionPaused]   = useState(false)
  const [resumeError,     setResumeError]     = useState(false)
  const [remainSec,       setRemainSec]       = useState(config.remaining_sec ?? 0)
  const [pauseQuotaSec,   setPauseQuotaSec]   = useState(config.pause_quota_sec ?? 0)
  const [pauseUsedSec,    setPauseUsedSec]    = useState(config.pause_used_sec ?? 0)
  const pauseStartRef = useRef<number | null>(null)
  const [fetchStatus,     setFetchStatus]     = useState<'idle'|'fetching'|'ok'|'err'>('idle')
  const [fetchSummary,    setFetchSummary]    = useState<string | null>(null)
  const [fetchSkipped,    setFetchSkipped]    = useState<{ name: string; reason: string }[]>([])
  const [engineStatus,    setEngineStatus]    = useState<PbStatus>('idle')
  const [cameraStatus,    setCameraStatus]    = useState<PbStatus>('idle')
  const [pbCreds,         setPbCreds]         = useState<{ email: string; password: string } | null>(null)
  const [updateState,     setUpdateState]     = useState<'idle'|'checking'|'available'|'uptodate'|'pulling'|'ok'|'err'>('idle')
  const [version,         setVersion]         = useState<{ current: string | null; isGit: boolean; label: string | null }>({ current: null, isGit: true, label: null })
  // Accordion: which group is open
  const [openGroup,       setOpenGroup]       = useState<string>('event')
  const toggleGroup = (id: string) => setOpenGroup(prev => prev === id ? '' : id)

  const isApi = engine.endsWith('_api')
  const UNLIMITED_SEC = 86400 * 300
  const isUnlimited = (config.bypassed ?? false) || remainSec >= UNLIMITED_SEC || pauseQuotaSec >= UNLIMITED_SEC

  const handleLocaleChange = (v: Locale) => {
    setLocale(v)
    onConfigSaved?.({ locale: v })
  }

  useEffect(() => {
    fetch('/api/pb-credentials').then(r => r.json()).then(setPbCreds).catch(() => null)
  }, [])

  useEffect(() => {
    setRemainSec(config.remaining_sec ?? 0)
  }, [config.remaining_sec])

  useEffect(() => {
    if (!open || sessionPaused) return
    const id = setInterval(() => setRemainSec(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [open, sessionPaused])

  useEffect(() => {
    if (config.pause_quota_sec != null) setPauseQuotaSec(config.pause_quota_sec)
    if (config.pause_used_sec != null) setPauseUsedSec(config.pause_used_sec)
  }, [config.pause_quota_sec, config.pause_used_sec])

  useEffect(() => {
    if (!open || !sessionPaused) return
    const id = setInterval(() => setPauseUsedSec(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [open, sessionPaused])

  useEffect(() => {
    if (!sessionPaused || pauseQuotaSec === 0 || pauseUsedSec < pauseQuotaSec) return
    resume?.()
    setSessionPaused(false)
    pauseStartRef.current = null
    fetch('/api/session-resume', { method: 'POST' }).catch(() => {})
  }, [sessionPaused, pauseUsedSec, pauseQuotaSec, resume])

  useEffect(() => {
    if (!open || isApi) { setEngineStatus('idle'); return }
    const ctrl = new AbortController()
    setEngineStatus('checking')
    fetch('http://localhost:8000/health', { signal: ctrl.signal, cache: 'no-store' })
      .then(r => { if (!ctrl.signal.aborted) setEngineStatus(r.ok ? 'connected' : 'offline') })
      .catch(() => { if (!ctrl.signal.aborted) setEngineStatus('offline') })
    return () => ctrl.abort()
  }, [open, engine, isApi])

  useEffect(() => {
    if (!open || camera !== 'canon') { setCameraStatus('idle'); return }
    const ctrl = new AbortController()
    setCameraStatus('checking')
    fetch('http://localhost:5513/', { signal: ctrl.signal, cache: 'no-store' })
      .then(() => { if (!ctrl.signal.aborted) setCameraStatus('connected') })
      .catch(() => { if (!ctrl.signal.aborted) setCameraStatus('offline') })
    return () => ctrl.abort()
  }, [open, camera])

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

  const dragIndex = useRef<number | null>(null)
  const dragSnapshot = useRef<typeof frames | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)

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
      const syncRes = await fetch('/api/sync-templates', { method: 'POST' })
      if (!syncRes.ok) { setFetchStatus('err'); setTimeout(() => setFetchStatus('idle'), 2500); return }
      const d = await syncRes.json() as {
        added: number; cropped: number; deleted: number
        detectDown: boolean; skipped: { name: string; reason: string }[]
      }
      const results = await fetchPocketBaseTemplates(pbUrl)
      onRefreshTemplates?.(results)
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

  useEffect(() => {
    if (!open) return
    fetch('/api/update')
      .then(r => r.json())
      .then((d: { current: string | null; isGit: boolean; label: string | null }) => setVersion({ current: d.current, isGit: d.isGit, label: d.label }))
      .catch(() => {})
  }, [open])

  const handleCheckUpdate = async () => {
    setUpdateState('checking')
    try {
      const res = await fetch('/api/update', { cache: 'no-store' })
      const d = await res.json() as { hasUpdate: boolean; current: string | null; isGit: boolean; label: string | null }
      setVersion({ current: d.current, isGit: d.isGit, label: d.label })
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
        setUpdateState('ok')
      } else {
        setUpdateState('err')
        setTimeout(() => setUpdateState('idle'), 3500)
      }
    } catch {
      setUpdateState('err')
      setTimeout(() => setUpdateState('idle'), 3500)
    }
  }

  // Restart booth ke IDLE — reload biasa nyimpen hash (#preview dll) → balik ke layar kosong.
  // Clear hash dulu baru reload biar mulai bersih dari idle.
  const restartToIdle = () => { window.location.hash = ''; window.location.reload() }

  // Verify secret baru dengan re-handshake ke Worker (via /api/heartbeat). Ga perlu refresh manual.
  const verifySecret = async (): Promise<'valid' | 'expired' | 'invalid' | 'offline'> => {
    try {
      const res = await fetch('/api/heartbeat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      if (res.ok) {
        const d = await res.json().catch(() => ({}))
        return d.freeware ? 'expired' : 'valid' // freeware = kunci valid TAPI sewa belum aktif
      }
      if (res.status === 402) return 'expired'
      if (res.status === 401 || res.status === 403) return 'invalid'
      return 'offline' // 503 / lainnya = server ga kejangkau
    } catch {
      return 'offline'
    }
  }

  const handleSaveSecret = async () => {
    if (!secret.trim()) return
    setSecretSaving(true)
    setSecretSaved(false)
    setVerify('idle')
    setRestartIn(null)
    try {
      const res = await fetch('/api/save-secret', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secret.trim() }),
      })
      if (!res.ok) return
      setSecretSaved(true)
      onConfigSaved?.({ has_secret: true, secret_hint: secret.trim() })
      setSecret('')
      // Auto-verify — ga usah pencet refresh manual.
      setVerify('checking')
      const verdict = await verifySecret()
      setVerify(verdict)
      if (verdict === 'valid') {
        let n = 3
        setRestartIn(n)
        const id = setInterval(() => {
          n -= 1
          if (n <= 0) { clearInterval(id); restartToIdle(); return }
          setRestartIn(n)
        }, 1000)
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

            {/* ── GROUP 1: EVENT & IDENTITY ─────────────────────────────── */}
            <AccordionGroup id="event" icon="🎪" title="Event & Identity" open={openGroup === 'event'} onToggle={toggleGroup}>
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
              <Row label={t('set_event_name') as string}>
                <TextInput value={eventName} onChange={setEventName} />
              </Row>
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
            </AccordionGroup>

            {/* ── GROUP 2: CREATIVE & BRANDING ──────────────────────────── */}
            <AccordionGroup id="branding" icon="🎨" title="Creative & Branding" open={openGroup === 'branding'} onToggle={toggleGroup}>
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
                <Toggle on={!hideBg} onToggle={() => toggleHideBg(!hideBg)} />
              </div>
              {hideBg && <Row label={t('set_bg_color') as string}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
            </AccordionGroup>

            {/* ── GROUP 3: AI ENGINE & TEMPLATES ────────────────────────── */}
            <AccordionGroup id="engine" icon="🧠" title="AI Engine & Templates" open={openGroup === 'engine'} onToggle={toggleGroup}>
              {/* Engine Mode */}
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

              {/* Output folder */}
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

              {/* Templates */}
              <Row label={t('set_source') as string}>
                <Sel
                  value={templateSource}
                  options={[{ value: 'pocketbase', label: 'Epicyoung PB (localhost)' }]}
                  onChange={v => setTemplateSource(v as TemplateSource)}
                />
              </Row>
              {templateSource === 'pocketbase' && (
                <>
                  <Row label={t('set_pb_url') as string}>
                    <TextInput value={pbUrl} onChange={setPbUrl} placeholder="http://localhost:8090" mono />
                  </Row>
                  <div style={{ padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_status') as string}</span>
                      <StatusBadge status={pbStatus} t={t} />
                    </div>
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
            </AccordionGroup>

            {/* ── GROUP 4: HARDWARE & SYSTEM ────────────────────────────── */}
            <AccordionGroup id="hardware" icon="⚙️" title="Hardware & System" open={openGroup === 'hardware'} onToggle={toggleGroup}>
              {/* Camera */}
              <Row label={t('set_source') as string}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {camera === 'canon' && <StatusBadge status={cameraStatus} t={t} />}
                  <Sel value={camera} options={CAMERA_OPTS} onChange={setCamera} />
                </div>
              </Row>

              {/* License / Secret */}
              <div style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_secret_label') as string}</span>
                    <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0' }}>
                      {config.has_secret ? t('set_secret_installed') as string : t('set_secret_empty_hint') as string}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={restartToIdle}
                      aria-label="Restart booth & re-check license"
                      title="Restart booth (kembali ke idle) & cek ulang lisensi"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 'var(--radius-glass)', color: 'rgba(255,255,255,0.65)', cursor: 'pointer', fontSize: 'var(--text-sm)', lineHeight: 1, padding: '5px 9px' }}
                    >↻</button>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: isUnlimited ? 700 : 400, letterSpacing: isUnlimited ? '0.06em' : undefined, fontFamily: 'var(--font-ui)', color: isUnlimited ? '#f0c040' : config.licensed ? '#a3be8c' : config.has_secret ? '#f0c040' : 'rgba(255,255,255,0.3)' }}>
                      {config.bypassed ? '⚡ GODMODE' : isUnlimited ? '∞ UNLIMITED' : config.licensed ? t('set_secret_state_active') as string : config.has_secret ? t('set_secret_state_expired') as string : '—'}
                    </span>
                  </div>
                </div>
                {!secretEditing ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                    <span style={{
                      flex: 1, background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 'var(--radius-glass)',
                      color: 'rgba(255,255,255,0.5)',
                      fontSize: 'var(--text-sm)',
                      fontWeight: 400,
                      padding: '9px 12px',
                      fontFamily: 'var(--font-ui)', letterSpacing: '0.12em', userSelect: 'none',
                    }}>
                      {config.has_secret && config.secret_hint
                        ? secretRevealed
                          ? config.secret_hint
                          : (h => h.length > 4 ? h.slice(0, 4) + h.slice(4).replace(/[^-]/g, '*') : h.replace(/./g, '*'))(config.secret_hint)
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
                          flex: 1, background: 'rgba(255,255,255,0.08)',
                          border: `1px solid ${verify === 'valid' ? 'rgba(163,190,140,0.7)' : verify === 'invalid' ? 'rgba(255,107,107,0.7)' : verify === 'expired' ? 'rgba(240,192,64,0.6)' : 'rgba(255,255,255,0.13)'}`,
                          borderRadius: 'var(--radius-glass)', color: '#fff', fontSize: 'var(--text-sm)', padding: '9px 12px',
                          fontFamily: 'var(--font-ui)', letterSpacing: '0.05em', outline: 'none', transition: 'border-color 0.2s',
                        }}
                      />
                      <button onClick={handleSaveSecret} disabled={secretSaving || verify === 'checking' || verify === 'valid' || !secret.trim()} style={{
                        padding: '0 18px', borderRadius: 'var(--radius-glass)', border: 'none',
                        background: 'var(--brand)',
                        color: '#fff', fontSize: 'var(--text-sm)', fontWeight: 600,
                        fontFamily: 'var(--font-ui)', cursor: secretSaving || verify === 'checking' || !secret.trim() ? 'default' : 'pointer',
                        whiteSpace: 'nowrap', opacity: secretSaving || verify === 'checking' || verify === 'valid' || !secret.trim() ? 0.6 : 1,
                      }}>
                        {secretSaving ? '…' : verify === 'checking' ? 'Cek…' : t('set_secret_save') as string}
                      </button>
                      <button onClick={() => { setSecretEditing(false); setVerify('idle'); setRestartIn(null) }} style={{
                        padding: '0 12px', borderRadius: 'var(--radius-glass)', border: '1px solid rgba(255,255,255,0.15)',
                        background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 'var(--text-xs)',
                        fontFamily: 'var(--font-ui)', cursor: 'pointer',
                      }}>
                        {t('set_secret_cancel') as string}
                      </button>
                    </div>
                    {/* Hasil auto-verify — hijau valid (auto-restart), amber sewa habis, merah salah, abu offline. */}
                    {verify === 'checking' && (
                      <p style={{ fontSize: 'var(--text-2xs)', color: '#f0c040', margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(240,192,64,0.3)', borderTopColor: '#f0c040', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                        Memverifikasi kunci…
                      </p>
                    )}
                    {verify === 'valid' && (
                      <p style={{ fontSize: 'var(--text-2xs)', color: '#a3be8c', margin: '8px 0 0', fontWeight: 600 }}>
                        ✓ Kunci valid — restart dalam {restartIn ?? 3}…
                      </p>
                    )}
                    {verify === 'expired' && (
                      <p style={{ fontSize: 'var(--text-2xs)', color: '#f0c040', margin: '8px 0 0' }}>
                        ⏳ Kunci benar, tapi sewa belum/sudah tidak aktif. Hubungi admin.
                      </p>
                    )}
                    {verify === 'invalid' && (
                      <p style={{ fontSize: 'var(--text-2xs)', color: '#ff6b6b', margin: '8px 0 0', fontWeight: 600 }}>
                        ✗ Kunci salah / mesin dinonaktifkan. Cek lagi kodenya.
                      </p>
                    )}
                    {verify === 'offline' && (
                      <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.5)', margin: '8px 0 0' }}>
                        Butuh internet buat verifikasi — cek koneksi, lalu Simpan lagi.
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Timer + Pause */}
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

              {/* Pause Quota */}
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
                        <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                          {isUnlimited ? (
                            <>
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

              {/* Status lampu — clean output & QR cuma nyala kalau licensed (timer + key aman).
                  Default abu2. Godmode/unlimited = licensed=true → ikut nyala. */}
              <div style={{ display: 'flex', gap: 10, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {([
                  { on: config.licensed ?? false, label: 'NO WATERMARK' },
                  { on: config.licensed ?? false, label: 'QR ACTIVE' },
                ] as const).map(({ on, label }) => (
                  <div key={label} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-glass)', padding: '8px 12px' }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: on ? '#a3be8c' : 'rgba(255,255,255,0.2)', boxShadow: on ? '0 0 8px rgba(163,190,140,0.8)' : 'none', transition: 'background .2s, box-shadow .2s' }} />
                    <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, letterSpacing: '0.06em', fontFamily: 'var(--font-ui)', color: on ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)' }}>{label}</span>
                  </div>
                ))}
              </div>

              {/* System / Update */}
              <div style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_version_label') as string}</span>
                    <p style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-ui)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0' }}>
                      {version.label ?? version.current ?? '—'}
                      {version.label && version.current && (
                        <span style={{ color: 'rgba(255,255,255,0.18)', marginLeft: 6 }}>({version.current})</span>
                      )}
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
            </AccordionGroup>

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

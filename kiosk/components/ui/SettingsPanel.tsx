'use client'
import { useState, useEffect, useRef } from 'react'
import type { KioskConfig, Template, TemplateSource, Locale, ComfyModelFamily, ComfyControlnetMode, VideoProvider } from '@/lib/types'
import { fetchPocketBaseTemplates } from '@/lib/pocketbase'
import { isVideoUnlocked } from '@/lib/video'
import { useT } from '@/lib/i18n'
import type { Translations } from '@/lib/locales/types'

type TFn = (key: keyof Translations) => Translations[keyof Translations]
type EngineKey = 'faceswap_local' | 'gohst_local' | 'fullbody_local' | 'print_local' | 'faceswap_api' | 'fullbody_api'

import { LocalTemplateManager } from './LocalTemplateManager'
import { VideoPromptManager } from './VideoPromptManager'

const ENGINE_OPTS: { value: EngineKey; label: string; soon?: boolean }[] = [
  { value: 'faceswap_local', label: 'Faceswap (LOCAL)' },
  { value: 'gohst_local',    label: 'GOHST (LOCAL)' },
  { value: 'fullbody_local', label: 'Fullbody (LOCAL)' }, // = engine comfy stylize via face_server
  { value: 'print_local',    label: 'Photo Print (non-AI)' }, // photobooth klasik: overlay PNG + N shot, nol token
  { value: 'faceswap_api',   label: 'Faceswap (API) — soon',  soon: true },
  { value: 'fullbody_api',   label: 'Fullbody (API) — soon',  soon: true },
]
const API_MODEL_OPTS = [
  { value: 'nanobanana2', label: 'Nano Banana Pro' },
  { value: 'gptimg2',     label: 'GPT Image 2'     },
  { value: 'flux1dev',    label: 'Flux.1 dev'      },
  { value: 'flux2pro',    label: 'Flux 2 Pro'      },
]
const CAMERA_OPTS = [
  { value: 'webcam', label: 'Webcam (getUserMedia)' },
  { value: 'canon',  label: 'Canon (digiCamControl)' },
]
// Stylize (face_server) — opsi asli dari GET :8000/capabilities, ini cuma label map.
const COMFY_FAMILY_LABELS: Record<string, string> = { sd15: 'SD 1.5', sdxl: 'SDXL', flux: 'Flux' }
const COMFY_CONTROLNET_LABELS: Record<string, string> = { canny: 'Canny (lines/outline)', depth: 'Depth (3D depth)', off: 'Off' }
// Sampler/scheduler — value '' = default per family. Allowlist sinkron sama comfy_client.py.
const COMFY_SAMPLER_OPTS = [
  { value: '',                label: 'Default (per family)' },
  { value: 'dpmpp_2m',        label: 'DPM++ 2M' },
  { value: 'dpmpp_2m_sde',    label: 'DPM++ 2M SDE' },
  { value: 'dpmpp_sde',       label: 'DPM++ SDE' },
  { value: 'euler',           label: 'Euler' },
  { value: 'euler_ancestral', label: 'Euler a' },
  { value: 'ddim',            label: 'DDIM' },
  { value: 'uni_pc',          label: 'UniPC' },
]
const COMFY_SCHEDULER_OPTS = [
  { value: '',            label: 'Default (per family)' },
  { value: 'karras',      label: 'Karras' },
  { value: 'normal',      label: 'Normal' },
  { value: 'simple',      label: 'Simple' },
  { value: 'sgm_uniform', label: 'SGM Uniform' },
  { value: 'exponential', label: 'Exponential' },
]
// CFG override — '' = default per family (sd15/sdxl 7). Server clamp 1-12, flux dikunci 1.0.
const COMFY_CFG_OPTS = [
  { value: '', label: 'Default (per family)' },
  ...['3', '4', '5', '6', '7', '8', '9', '10'].map(v => ({ value: v, label: v })),
]
// Steps override — semua "aman", beda cuma speed vs detail halus. '' = default (sd15/sdxl 30).
// Server clamp 15-30, flux dikunci 20.
const COMFY_STEPS_OPTS = [
  { value: '', label: 'Default (per family)' },
  ...['15', '20', '25', '30'].map(v => ({ value: v, label: v })),
]
// ControlNet strength override — '' = default 0.8. Server clamp 0.3-1.0.
const COMFY_CN_STRENGTH_OPTS = [
  { value: '', label: 'Default (0.8)' },
  ...['0.3', '0.5', '0.6', '0.7', '0.8', '0.9', '1.0'].map(v => ({ value: v, label: v })),
]
const COMFY_CONTROLNET_STRENGTH = 0.8 // fixed di face_server — hanya buat recipe line
// Video engine (img2vid) providers — semua lewat FAL, bedanya endpoint FAL per provider (Worker).
// HAPPYHORSE sengaja gak masuk list: OFF permanen (HPP mahal). Kalau mau balik, tambah di sini
// + isi harga di DEFAULT_VIDEO_COSTS + enable di /dashboard/settings. Server tetap gate via RPC.
// 3 tier doang (build B): Murah/Medium/Mahal. Sisanya (Vidu/Veo/WAN/Kling/HappyHorse) di-off dari
// UI — endpoint-nya masih di worker (video-provider.ts) kalau suatu saat mau dibalikin. Harga token
// di-append otomatis di map bawah (videoProviderOpts).
const VIDEO_PROVIDER_OPTS: { value: VideoProvider; label: string }[] = [
  { value: 'LTX',      label: 'Budget — LTX 2.3'       },
  { value: 'PIXVERSE', label: 'Standard — PixVerse V6' },
  { value: 'SEEDANCE', label: 'Premium — Seedance Fast' },
]

type StylizeCaps = {
  stylize: boolean
  families: Record<string, string[]>
  controlnets: string[]
  face_lock: boolean
}

// Prepend saved value kalau ga ada di caps — biar save ga diam-diam nge-flip setting.
function withSaved(list: string[], saved: string): string[] {
  return list.includes(saved) ? list : [saved, ...list]
}

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
  onQuickSync?: () => void
  onRebuild?: () => void
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

// Row + footnote awam di bawah label — buat setting teknis (CFG/steps/ControlNet strength)
// yang namanya sendiri gak cukup jelas buat operator non-teknis.
function RowHint({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 16 }}>
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{label}</span>
        <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0', lineHeight: 1.4 }}>{hint}</p>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function Toggle({ on, onToggle, disabled = false }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={disabled ? undefined : onToggle} disabled={disabled} style={{ background: 'none', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', padding: 0, opacity: disabled ? 0.4 : 1 }}>
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

export function SettingsPanel({ open, onClose, config, onConfigSaved, pause, resume, onRefreshTemplates, onQuickSync, onRebuild }: Props) {
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
  const [comfyFamily,     setComfyFamily]     = useState<ComfyModelFamily>(config.comfy_model_family ?? 'sd15')
  const [comfyCheckpoint, setComfyCheckpoint] = useState(config.comfy_checkpoint ?? 'epicrealism_pureEvolutionV5.safetensors')
  const [comfyControlnet, setComfyControlnet] = useState<ComfyControlnetMode>(config.comfy_controlnet ?? 'canny')
  const [comfyDenoise,    setComfyDenoise]    = useState(config.comfy_denoise ?? 0.65)
  const [comfyFaceLock,   setComfyFaceLock]   = useState(config.comfy_face_lock ?? true)
  const [comfySampler,    setComfySampler]    = useState(config.comfy_sampler ?? '')
  const [comfyScheduler,  setComfyScheduler]  = useState(config.comfy_scheduler ?? '')
  const [comfyCfg,        setComfyCfg]        = useState(config.comfy_cfg ?? '')
  const [comfySteps,      setComfySteps]      = useState(config.comfy_steps ?? '')
  const [comfyCnStrength, setComfyCnStrength] = useState(config.comfy_cn_strength ?? '')
  const [maxTemplates,    setMaxTemplates]    = useState(config.max_templates ?? 1)
  const [magicCatcher,    setMagicCatcher]    = useState(config.enable_magic_catcher ?? false)
  const [showPromptDesigner, setShowPromptDesigner] = useState(false)
  const [videoEngine,     setVideoEngine]     = useState(config.enable_video_engine ?? false)
  // Default LTX — 1080p native, murah & tajam. Provider dipangkas ke 3 tier (LTX/PIXVERSE/SEEDANCE);
  // config lama yg ke-set VEO/WAN/VIDU/KLING udah ga ada di dropdown → jatuhin ke LTX biar select ga
  // nampilin option pertama sambil state nyimpen value hantu (operator save-nya jadi salah).
  const [videoProvider,   setVideoProvider]   = useState<VideoProvider>(() => {
    const p = config.video_provider
    return p && VIDEO_PROVIDER_OPTS.some(o => o.value === p) ? p : 'LTX'
  })
  // Default 720p (hemat). 1080p pakai tarif cost_1080; provider tanpa tarif itu tetep dicharge+render 720p.
  const [videoResolution, setVideoResolution] = useState<'720p' | '1080p'>(config.video_resolution ?? '720p')
  const [videoDuration,   setVideoDuration]   = useState<number>(config.video_duration ?? 8)

  // Dompet token — fetch pas panel dibuka (fresh, gak nunggu heartbeat 60s). Pola sama
  // kayak verifySecret: /api/heartbeat pakai secret tersimpan server-side. Freeware/
  // bypassed/offline gak bawa saldo → null → tampil '—'.
  const [tokenBalance, setTokenBalance] = useState<number | null>(null)
  // Cache harga terakhir dari handshake → offline pake ini, BUKAN hardcoded (nyegah drift admin).
  const [videoCosts, setVideoCosts] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('lastVideoCosts') || '{}') } catch { return {} }
  })
  useEffect(() => {
    if (!open) return
    let live = true
    fetch('/api/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!live || !d) return
        setTokenBalance(typeof d.tenant_token_balance === 'number' ? d.tenant_token_balance : null)
        // Cuma timpa cache kalau handshake beneran bawa harga — respons kosong ga ngehapus cache.
        if (d.video_costs && Object.keys(d.video_costs).length > 0) {
          setVideoCosts(d.video_costs)
          try { localStorage.setItem('lastVideoCosts', JSON.stringify(d.video_costs)) } catch {}
        }
      })
      .catch(() => {/* offline → pake cache terakhir */})
    return () => { live = false }
  }, [open])
  // Footnote harga video ala SaaS — harga dari dashboard admin (app_settings), bukan hardcode.
  // 1080p: tarif <PROVIDER>_1080 kalau ada; gak ada = provider tsb dicharge 720p (fail-safe Worker).
  const has1080Rate = videoCosts[`${videoProvider}_1080`] != null
  // Seed hari-1 DOANG: kepake cuma kalau localStorage 'lastVideoCosts' masih kosong (kiosk
  // belum pernah handshake sekali pun). Sekali handshake sukses, cache nimpa ini selamanya —
  // jadi ini bukan lagi sumber drift. Angka boleh basi dikit, ga kritis (ke-overwrite cepat).
  const DEFAULT_VIDEO_COSTS: Record<string, number> = {
    LTX: 9, LTX_1080: 9,             // LTX native 1080p, tarif sama
    PIXVERSE: 10, PIXVERSE_1080: 20,
    VIDU: 14, VIDU_1080: 30,
    VEO: 22, VEO_1080: 22,           // Veo 1080p harga sama
    WAN: 22, WAN_1080: 33,
    KLING: 25,                       // no param resolusi → 1080p fallback 720p
    SEEDANCE: 57, SEEDANCE_1080: 77,
  }
  const selectedVideoCost = (videoResolution === '1080p' && has1080Rate
    ? (videoCosts[`${videoProvider}_1080`] ?? DEFAULT_VIDEO_COSTS[`${videoProvider}_1080`])
    : (videoCosts[videoProvider] ?? DEFAULT_VIDEO_COSTS[videoProvider])) as number | undefined
  const videoProviderOpts = VIDEO_PROVIDER_OPTS.filter(o => {
    // Filter provider yang di-disable dari Admin UI. Server cuma ngirim yang enabled.
    if (Object.keys(videoCosts).length > 0) return videoCosts[o.value] != null;
    // Fallback saat offline (ga handshake): hanya tampilkan yang ada tarif defaultnya.
    return DEFAULT_VIDEO_COSTS[o.value] != null || DEFAULT_VIDEO_COSTS[`${o.value}_1080`] != null;
  }).map(o => {
    const cost720 = videoCosts[o.value] ?? DEFAULT_VIDEO_COSTS[o.value]
    const cost1080 = videoCosts[`${o.value}_1080`] ?? DEFAULT_VIDEO_COSTS[`${o.value}_1080`]
    if (cost720 == null) return o
    let priceStr = ''
    if (o.value === 'LTX') priceStr = `FHD ${cost720} Tok`
    else if (cost1080 != null) priceStr = `HD ${cost720} Tok / FHD ${cost1080} Tok`
    else priceStr = `HD ${cost720} Tok`
    return { ...o, label: `${o.label} (${priceStr})` }
  })
  const [comfyStatus,     setComfyStatus]     = useState<PbStatus>('idle')
  const [comfyCaps,       setComfyCaps]       = useState<StylizeCaps | null>(null)
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
  const [engineStatus,    setEngineStatus]    = useState<PbStatus>('idle')
  const [cameraStatus,    setCameraStatus]    = useState<PbStatus>('idle')
  const [pbCreds,         setPbCreds]         = useState<{ email: string; password: string } | null>(null)
  const [updateState,     setUpdateState]     = useState<'idle'|'checking'|'available'|'uptodate'|'pulling'|'ok'|'err'>('idle')
  const [version,         setVersion]         = useState<{ current: string | null; isGit: boolean; label: string | null }>({ current: null, isGit: true, label: null })
  // Accordion: which group is open
  const [openGroup,       setOpenGroup]       = useState<string>('event')
  const toggleGroup = (id: string) => setOpenGroup(prev => prev === id ? '' : id)

  const isApi = engine.endsWith('_api')
  // Yang dipake aja yang terpampang — opsi murni dari caps, saved value di-prepend biar ga ilang.
  const comfyFamilyOpts = withSaved(Object.keys(comfyCaps?.families ?? {}), comfyFamily)
    .map(v => ({ value: v, label: COMFY_FAMILY_LABELS[v] ?? v }))
  const comfyCkptOpts = withSaved(comfyCaps?.families[comfyFamily] ?? [], comfyCheckpoint)
    .map(v => ({ value: v, label: v }))
  const comfyControlnetOpts = withSaved([...(comfyCaps?.controlnets ?? []), 'off'], comfyControlnet)
    .map(v => ({ value: v, label: COMFY_CONTROLNET_LABELS[v] ?? v }))
  // Flux kunci mati sampler/scheduler/cfg/steps di server (lihat resolve_sampler comfy_client.py)
  // — override apa pun diabaikan, jadi jangan ditampilin di recipe biar gak nyesatin operator.
  const comfyFluxLocked = comfyFamily === 'flux'
  const comfyRecipe = [
    COMFY_FAMILY_LABELS[comfyFamily] ?? comfyFamily,
    comfyCheckpoint.replace(/\.(safetensors|ckpt)$/i, ''),
    comfyControlnet === 'off' ? 'controlnet off' : `${comfyControlnet} ${comfyCnStrength || COMFY_CONTROLNET_STRENGTH}`,
    `denoise ${comfyDenoise.toFixed(2)}`,
    !comfyFluxLocked && comfyCfg ? `cfg ${comfyCfg}` : null,
    !comfyFluxLocked && comfySteps ? `${comfySteps} steps` : null,
    `face lock ${comfyFaceLock ? 'ON' : 'OFF'}`,
  ].filter(Boolean).join(' · ')
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

  // Stylize caps — satu fetch ke face_server, kiosk ga perlu tau backend-nya apa.
  useEffect(() => {
    if (!open) { setComfyStatus('idle'); return }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000) // ponytail: short timeout, jangan gantung nunggu server mati
    let closed = false
    setComfyStatus('checking')
    fetch('http://localhost:8000/capabilities', { signal: ctrl.signal, cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((caps: StylizeCaps) => {
        if (closed) return
        setComfyCaps(caps)
        setComfyStatus(caps.stylize ? 'connected' : 'offline')
      })
      .catch(() => { if (!closed) { setComfyCaps(null); setComfyStatus('offline') } })
      .finally(() => clearTimeout(timer))
    return () => { closed = true; clearTimeout(timer); ctrl.abort() }
  }, [open])

  useEffect(() => {
    if (!open || camera !== 'canon') { setCameraStatus('idle'); return }
    const ctrl = new AbortController()
    setCameraStatus('checking')
    // no-cors: digiCamControl webserver ga kirim header CORS → fetch 'cors' biasa ke-reject walau
    // server HIDUP (browser bisa OPEN 5513, tapi fetch() lintas-origin diblok). Opaque response
    // cukup buat liveness probe — kita cuma butuh tau reachable/nggak, bukan baca body-nya.
    fetch('http://localhost:5513/', { signal: ctrl.signal, cache: 'no-store', mode: 'no-cors' })
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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store'
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
    try {
      const res = await fetch('/api/session-resume', { method: 'POST' })
      if (res.ok || res.status === 404) {
        const d = await res.json().catch(() => ({}))
        if (d?.pause_quota_sec != null) { setPauseQuotaSec(d.pause_quota_sec); setPauseUsedSec(d.pause_used_sec ?? 0) }
      }
    } catch {
      // Fire and forget - even if offline, unpause locally
    }
    pauseStartRef.current = null
    resume?.()
    setSessionPaused(false)
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
        comfy_model_family: comfyFamily,
        comfy_checkpoint:   comfyCheckpoint,
        comfy_controlnet:   comfyControlnet,
        comfy_denoise:      comfyDenoise,
        comfy_face_lock:    comfyFaceLock,
        comfy_sampler:      comfySampler,
        comfy_scheduler:    comfyScheduler,
        comfy_cfg:          comfyCfg,
        comfy_steps:        comfySteps,
        comfy_cn_strength:  comfyCnStrength,
        max_templates:      maxTemplates,
        enable_magic_catcher: magicCatcher,
        // Photo Print = non-AI → video selalu OFF, jangan nyimpen state nyangkut dari mode lain.
        enable_video_engine: engine === 'print_local' ? false : videoEngine,
        video_provider:      videoProvider,
        video_resolution:    videoResolution,
        video_duration:      videoDuration,
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
        comfy_model_family: comfyFamily,
        comfy_checkpoint:   comfyCheckpoint,
        comfy_controlnet:   comfyControlnet,
        comfy_denoise:      comfyDenoise,
        comfy_face_lock:    comfyFaceLock,
        comfy_sampler:      comfySampler,
        comfy_scheduler:    comfyScheduler,
        comfy_cfg:          comfyCfg,
        comfy_steps:        comfySteps,
        comfy_cn_strength:  comfyCnStrength,
        max_templates:      maxTemplates,
        enable_magic_catcher: magicCatcher,
        enable_video_engine: engine === 'print_local' ? false : videoEngine,
        video_provider:      videoProvider,
        video_resolution:    videoResolution,
        video_duration:      videoDuration,
        ...(logo_url ? { logo_url } : {}),
        ...(bg_url   ? { bg_url   } : {}),
      } as Partial<KioskConfig>)
      // Sisanya apply live (config reaktif). Kamera cuma re-init pas LiveView mount, dan
      // DUNIA TEMPLATE (faceswap vs comfy) disaring server-side pas boot → ganti kamera
      // ATAU engine mode wajib reload, kalau gak kategori comfy gak bakal muncul.
      if (camera !== (config.camera_source ?? 'webcam') || engine !== (config.engine_mode ?? 'faceswap_local')) restartToIdle()
      else onClose()
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
            <AccordionGroup id="event" icon="🎪" title={t('set_group_event') as string} open={openGroup === 'event'} onToggle={toggleGroup}>
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
                      { value: 'ms', label: 'Bahasa Melayu' },
                      { value: 'th', label: 'ไทย' },
                      { value: 'vi', label: 'Tiếng Việt' },
                      { value: 'tl', label: 'Filipino' },
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
            <AccordionGroup id="branding" icon="🎨" title={t('set_group_branding') as string} open={openGroup === 'branding'} onToggle={toggleGroup}>
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
            <AccordionGroup id="engine" icon="🧠" title={t('set_group_engine') as string} open={openGroup === 'engine'} onToggle={toggleGroup}>
              <Row label={t('set_token_balance') as string}>
                <span style={{
                  fontFamily: 'var(--font-ui)', fontSize: 'var(--text-sm)', fontWeight: 600, letterSpacing: '0.02em',
                  color: tokenBalance == null ? 'rgba(255,255,255,0.25)' : tokenBalance > 50 ? '#a3be8c' : tokenBalance > 0 ? '#f0c040' : '#ff6b6b',
                  background: 'rgba(0,0,0,0.2)', padding: '4px 10px', borderRadius: 'var(--radius-glass)', border: '1px solid rgba(255,255,255,0.05)'
                }}>
                  {tokenBalance == null ? '—' : `${tokenBalance.toLocaleString('id-ID')} ${t('set_token_unit') as string}`}
                </span>
              </Row>
              {/* Engine Mode */}
              <Row label={t('set_mode') as string}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {!isApi && <StatusBadge status={engineStatus} t={t} />}
                  <Sel value={engine} options={ENGINE_OPTS} onChange={v => {
                    const newEngine = v as EngineKey
                    setEngine(newEngine)
                    setTemplateSource(newEngine === 'print_local' ? 'json' : 'pocketbase')
                  }} />
                </div>
              </Row>
              {isApi && (
                <RowHint label={t('set_api_model') as string} hint={t('set_api_model_hint') as string}>
                  <Sel value={apiModel} options={API_MODEL_OPTS} onChange={setApiModel} />
                </RowHint>
              )}

              {/* Stylize = engine mode FULLBODY (LOCAL) — opsinya cuma muncul di mode itu,
                  jangan campur sama faceswap. Opsi murni dari GET :8000/capabilities. */}
              {engine === 'fullbody_local' && (<>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 0 2px' }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)' }}>Stylize (face_server)</span>
                <StatusBadge status={comfyStatus} t={t} />
              </div>
              {/* Recipe aktif — live unsaved state */}
              <p style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-ui)', color: 'rgba(255,255,255,0.35)', margin: '0 0 4px', wordBreak: 'break-all' }}>
                {comfyRecipe}
              </p>
              {comfyCaps ? (
                <>
                  <Row label={t('set_model_family') as string}>
                    <Sel value={comfyFamily} options={comfyFamilyOpts} onChange={v => {
                      setComfyFamily(v as ComfyModelFamily)
                      // Ganti family = reset checkpoint ke milik family baru — checkpoint
                      // lama nyangkut = pasangan mismatch kesimpen, /stylize nolak 400.
                      const first = comfyCaps?.families[v]?.[0]
                      if (first) setComfyCheckpoint(first)
                    }} />
                  </Row>
                  <Row label={t('set_checkpoint') as string}>
                    <Sel value={comfyCheckpoint} options={comfyCkptOpts} onChange={setComfyCheckpoint} />
                  </Row>
                  <RowHint label={t('set_controlnet') as string} hint={t('set_controlnet_hint') as string}>
                    <Sel value={comfyControlnet} options={comfyControlnetOpts} onChange={v => setComfyControlnet(v as ComfyControlnetMode)} />
                  </RowHint>
                  {comfyControlnet !== 'off' && (
                    <RowHint label={t('set_controlnet_strength') as string} hint={t('set_controlnet_strength_hint') as string}>
                      <Sel value={comfyCnStrength} options={COMFY_CN_STRENGTH_OPTS} onChange={setComfyCnStrength} />
                    </RowHint>
                  )}
                  {comfyCaps.face_lock && (
                    <Row label={t('set_face_lock') as string}>
                      <Toggle on={comfyFaceLock} onToggle={() => setComfyFaceLock(v => !v)} />
                    </Row>
                  )}
                  {/* Flux kunci mati sampler/scheduler/cfg/steps di server (resolve_sampler
                      comfy_client.py) — sembunyiin 4 kontrol ini biar operator gak nyetel
                      sesuatu yang diem-diem gak ngefek. */}
                  {comfyFluxLocked ? (
                    <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '8px 0' }}>
                      {t('set_flux_locked_note') as string}
                    </p>
                  ) : (
                    <>
                      <Row label={t('set_sampler') as string}>
                        <Sel value={comfySampler} options={COMFY_SAMPLER_OPTS} onChange={setComfySampler} />
                      </Row>
                      <Row label={t('set_scheduler') as string}>
                        <Sel value={comfyScheduler} options={COMFY_SCHEDULER_OPTS} onChange={setComfyScheduler} />
                      </Row>
                      <RowHint label={t('set_cfg') as string} hint={t('set_cfg_hint') as string}>
                        <Sel value={comfyCfg} options={COMFY_CFG_OPTS} onChange={setComfyCfg} />
                      </RowHint>
                      <RowHint label={t('set_steps') as string} hint={t('set_steps_hint') as string}>
                        <Sel value={comfySteps} options={COMFY_STEPS_OPTS} onChange={setComfySteps} />
                      </RowHint>
                    </>
                  )}
                </>
              ) : comfyStatus === 'offline' ? (
                <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '8px 0' }}>
                  {t('set_stylize_offline') as string}
                </p>
              ) : null}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_denoise') as string}</span>
                  <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0' }}>{t('set_denoise_hint') as string}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="range" min={0.10} max={0.95} step={0.05}
                    value={comfyDenoise}
                    onChange={e => setComfyDenoise(Number(e.target.value))}
                    style={{ width: 140, height: 4, accentColor: 'var(--brand)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-ui)', color: 'rgba(255,255,255,0.6)', width: 32, textAlign: 'right' }}>
                    {comfyDenoise.toFixed(2)}
                  </span>
                </div>
              </div>
              </>)}

              {/* Video engine (img2vid) — img output terakhir jadi seed ke provider video via
                  Worker. API key hidup di Worker (FAL), gak pernah ke browser. Default OFF.
                  Kebuka kalau super admin nyalain toggle Video kiosk ini (isVideoUnlocked)
                  atau godmode — kunci asli fail-closed di RPC deduct_video_tokens.
                  Photo Print (non-AI) = nol AI → seluruh blok video disembunyiin.
                  GATE: tanpa sewa aktif (licensed) & bukan godmode → LOCKED, walau admin
                  nyalain enable_video. Freeware murni (tanpa key/rental) ga boleh video. */}
              {engine !== 'print_local' && (() => {
                const hasRental = (config.licensed ?? false) || (config.bypassed ?? false)
                const videoLocked = !hasRental || !isVideoUnlocked(config)
                return (<>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>
                    {t('set_video_engine') as string}
                    {videoLocked && (
                      <span style={{ marginLeft: 8, fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-ui)', letterSpacing: '0.04em', color: '#f0c040', border: '1px solid rgba(240,192,64,0.4)', borderRadius: 6, padding: '1px 6px', whiteSpace: 'nowrap' }}>{t('set_video_locked_badge') as string}</span>
                    )}
                  </span>
                  <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0', lineHeight: 1.4 }}>
                    {!hasRental
                      ? t('set_video_need_rental') as string
                      : videoLocked
                        ? t('set_video_locked_note') as string
                        : t('set_video_enabled_note') as string}
                  </p>
                </div>
                <div style={{ flexShrink: 0 }}>
                  <Toggle on={videoLocked ? false : videoEngine} disabled={videoLocked} onToggle={() => setVideoEngine(v => !v)} />
                </div>
              </div>
              {!videoLocked && videoEngine && (<>
                <RowHint
                  label={t('set_video_provider') as string}
                  hint={selectedVideoCost != null
                    ? (t('set_video_provider_hint_cost') as string)
                        .replace('{res}', videoProvider === 'LTX' ? '1080p' : (videoResolution === '1080p' && has1080Rate ? '1080p' : '720p'))
                        .replace('{n}', String(selectedVideoCost))
                    : Object.keys(videoCosts).length > 0
                      ? t('set_video_provider_hint_disabled') as string
                      : t('set_video_provider_hint_online') as string}
                >
                  <Sel value={videoProvider} options={videoProviderOpts} onChange={v => setVideoProvider(v as VideoProvider)} />
                </RowHint>
                <RowHint
                  label={t('set_video_resolution') as string}
                  hint={videoProvider === 'LTX'
                    ? t('set_video_res_hint_ltx') as string
                    : videoResolution === '1080p' && !has1080Rate
                      ? t('set_video_res_hint_no1080') as string
                      : t('set_video_res_hint_default') as string}
                >
                  <Sel
                    value={videoResolution}
                    options={[
                      { value: '720p',  label: `720p — ${videoCosts[videoProvider] ?? DEFAULT_VIDEO_COSTS[videoProvider]} ${t('set_token_unit') as string}` },
                      { value: '1080p', label: `1080p — ${videoCosts[`${videoProvider}_1080`] ?? DEFAULT_VIDEO_COSTS[`${videoProvider}_1080`] ?? (videoCosts[videoProvider] ?? DEFAULT_VIDEO_COSTS[videoProvider])} ${t('set_token_unit') as string}` },
                    ]}
                    onChange={v => setVideoResolution(v as '720p' | '1080p')}
                  />
                </RowHint>
                <RowHint
                  label={t('set_video_duration') as string}
                  hint={videoProvider === 'LTX'
                    ? t('set_video_dur_hint_ltx') as string
                    : t('set_video_dur_hint_default') as string}
                >
                  <Sel
                    value={String(videoProvider === 'LTX' ? 8 : videoDuration)}
                    options={[
                      { value: '5', label: videoProvider === 'LTX' ? t('set_video_dur_5s_ltx') as string : t('set_video_dur_5s') as string, soon: videoProvider === 'LTX' },
                      { value: '8', label: t('set_video_dur_8s') as string },
                    ]}
                    onChange={v => setVideoDuration(Number(v))}
                  />
                </RowHint>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <div>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_video_prompt_designer') as string}</span>
                    <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0' }}>{t('set_video_prompt_designer_hint') as string}</p>
                  </div>
                  <button
                    onClick={() => setShowPromptDesigner(true)}
                    style={{
                      padding: '8px 16px', borderRadius: 'var(--radius-glass)', border: '1px solid rgba(255,255,255,0.15)',
                      background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 'var(--text-xs)',
                      fontFamily: 'var(--font-ui)', cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    {t('set_video_prompt_designer_btn') as string}
                  </button>
                </div>
              </>)}
              </>) })()}

              {/* Output folder */}
              <Row label={t('set_folder') as string}>
                <TextInput value={outputDir} onChange={setOutputDir} placeholder="C:/semeta" mono />
              </Row>

              {/* VIP: max templates per guest — FACESWAP LOCAL only (multi-swap sequential via
                  face_server :8000). Fullbody = comfy single. Faceswap API belum ada impl multi. */}
              {(engine === 'faceswap_local' || engine === 'gohst_local') && (
                <div style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_max_templates') as string}</span>
                    <Sel
                      value={String(maxTemplates)}
                      options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }]}
                      onChange={v => setMaxTemplates(Number(v))}
                    />
                  </div>
                  <p style={{ fontSize: 'var(--text-2xs)', color: maxTemplates > 1 ? '#f0c040' : 'rgba(255,255,255,0.3)', margin: '6px 0 0' }}>
                    {maxTemplates > 1 ? '⚠ ' : ''}{t('set_max_templates_hint') as string}
                  </p>
                </div>
              )}

              <div style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_pb_data') as string}</span>
                  <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-ui)', color: 'rgba(255,255,255,0.3)' }}>C:/semeta/pb/pb_data/</span>
                </div>
                <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.25)', margin: '4px 0 0' }}>{t('set_pb_data_note') as string}</p>
              </div>

              {/* Templates */}
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
                        onClick={onQuickSync}
                        style={{
                          ...pbActionBtn,
                          cursor: 'pointer',
                        }}
                      >
                        {t('set_fetch_idle') as string}
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
                    {/* ponytail: repair thumbnail 404 — wipe record + re-import dari folder. Operator-only, string inline (no i18n plumbing). */}
                    <button
                      onClick={() => { if (onRebuild && confirm('Rebuild SEMUA template dari folder put-template-here?\n\nSemua template di database dihapus lalu di-import ulang dari folder. Template yang cuma ada di admin (bukan di folder) akan HILANG.\n\nPakai ini kalau thumbnail rusak / 404.')) onRebuild() }}
                      style={{ ...pbActionBtn, cursor: 'pointer', width: '100%', marginTop: 10, color: 'rgba(255,180,120,0.9)', borderColor: 'rgba(255,150,80,0.25)' }}
                    >
                      ⟳ Rebuild dari folder (repair thumbnail 404)
                    </button>
                  </div>
                </>
              )}
              {templateSource === 'json' && (
                <>
                  <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.28)', marginTop: 6 }}>
                    {t('set_json_note') as string}
                  </p>
                  <LocalTemplateManager onRefreshTemplates={onRefreshTemplates} />
                </>
              )}
            </AccordionGroup>

            {/* ── GROUP 4: HARDWARE & SYSTEM ────────────────────────────── */}
            <AccordionGroup id="hardware" icon="⚙️" title={t('set_group_hardware') as string} open={openGroup === 'hardware'} onToggle={toggleGroup}>
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
                      aria-label={t('set_restart_booth_title') as string}
                      title={t('set_restart_booth_title') as string}
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
                        {secretSaving ? '…' : verify === 'checking' ? t('set_secret_verify_btn_checking') as string : t('set_secret_save') as string}
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
                        {t('set_verify_checking') as string}
                      </p>
                    )}
                    {verify === 'valid' && (
                      <p style={{ fontSize: 'var(--text-2xs)', color: '#a3be8c', margin: '8px 0 0', fontWeight: 600 }}>
                        {(t('set_verify_valid') as string).replace('{n}', String(restartIn ?? 3))}
                      </p>
                    )}
                    {verify === 'expired' && (
                      <p style={{ fontSize: 'var(--text-2xs)', color: '#f0c040', margin: '8px 0 0' }}>
                        {t('set_verify_expired') as string}
                      </p>
                    )}
                    {verify === 'invalid' && (
                      <p style={{ fontSize: 'var(--text-2xs)', color: '#ff6b6b', margin: '8px 0 0', fontWeight: 600 }}>
                        {t('set_verify_invalid') as string}
                      </p>
                    )}
                    {verify === 'offline' && (
                      <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.5)', margin: '8px 0 0' }}>
                        {t('set_verify_offline') as string}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Dompet token tenant — saldo kepotong cuma sama cloud AI (foto API + video).
                  Faceswap lokal / comfy / Photo Print = 0 token. Saldo dari handshake pas panel dibuka. */}
              <Row label={t('set_token_balance') as string}>
                <span style={{
                  fontFamily: 'var(--font-ui)', fontSize: 'var(--text-lg)', fontWeight: 600, letterSpacing: '0.03em',
                  color: tokenBalance == null ? 'rgba(255,255,255,0.25)' : tokenBalance > 50 ? '#a3be8c' : tokenBalance > 0 ? '#f0c040' : '#ff6b6b',
                }}>
                  {tokenBalance == null ? '—' : `${tokenBalance.toLocaleString('id-ID')} ${t('set_token_unit') as string}`}
                </span>
              </Row>

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
                      <button onClick={handleResume} style={{
                        padding: '6px 16px', borderRadius: 'var(--radius-glass)', border: 'none', cursor: 'pointer',
                        background: '#a3e635',
                        color: 'var(--bg)', fontWeight: 600, fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)',
                      }}>
                        {t('set_resume') as string}
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
                  { on: config.licensed ?? false, label: t('set_status_no_watermark') as string },
                  { on: config.licensed ?? false, label: t('set_status_qr_active') as string },
                ] as const).map(({ on, label }) => (
                  <div key={label} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-glass)', padding: '8px 12px' }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: on ? '#a3be8c' : 'rgba(255,255,255,0.2)', boxShadow: on ? '0 0 8px rgba(163,190,140,0.8)' : 'none', transition: 'background .2s, box-shadow .2s' }} />
                    <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, letterSpacing: '0.06em', fontFamily: 'var(--font-ui)', color: on ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)' }}>{label}</span>
                  </div>
                ))}
              </div>

              {/* Magic Catcher — reaction cam toggle. Recording gated by IdleScreen disclaimer. */}
              <div style={{ padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ maxWidth: 380 }}>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{t('set_magic_catcher') as string}</span>
                    <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0' }}>
                      {t('set_magic_catcher_hint') as string}
                      <br />
                      <span style={{ color: '#f0c040', marginTop: 2, display: 'inline-block' }}>{t('set_magic_catcher_webcam_only') as string}</span>
                    </p>
                  </div>
                  <Toggle on={magicCatcher} onToggle={() => setMagicCatcher(v => !v)} />
                </div>
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
      <VideoPromptManager open={showPromptDesigner} onClose={() => setShowPromptDesigner(false)} config={config} onConfigChanged={onConfigSaved ?? (() => {})} />
    </>
  )
}

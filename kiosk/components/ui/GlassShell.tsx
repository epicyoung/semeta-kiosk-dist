'use client'
import { useRef, useState, useLayoutEffect, useEffect, type ReactNode } from 'react'
import { SettingsPanel } from './SettingsPanel'
import { SyncProgress, type SyncPhase } from './SyncProgress'
import { LocaleProvider } from '@/lib/i18n'
import { EPIC_LOGO } from '@/lib/brand'
import { fetchPocketBaseTemplates } from '@/lib/pocketbase'
import type { KioskConfig } from '@/lib/types'

type Direction = 'forward' | 'backward'

type Page = { key: string; node: ReactNode; anim: string }

type Props = {
  screenKey: string
  direction: Direction
  children: ReactNode
  config: KioskConfig
  onLogoClick?: () => void
  pause?: () => void
  resume?: () => void
  onRefreshTemplates?: (templates: KioskConfig['templates']) => void
  // Settings save → propagate ke parent (KioskApp) biar screen ikut reaktif (max_templates,
  // magic catcher, dll) tanpa perlu reload. Tanpa ini config perubahan cuma kelihatan di panel.
  onConfigChange?: (updated: Partial<KioskConfig>) => void
}

export function GlassShell({ screenKey, direction, children, config, onLogoClick, pause, resume, onRefreshTemplates, onConfigChange }: Props) {
  const [pages, setPages] = useState<Page[]>([
    { key: screenKey, node: children, anim: 'none' },
  ])
  const [gridDebug, setGridDebug] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [localConfig, setLocalConfig] = useState(config)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ok' | 'err'>('idle')
  const [syncPhase, setSyncPhase] = useState<SyncPhase | null>(null)

  // Sync folder→PB lalu refresh templates ke kiosk. Sama seperti tombol di Settings.
  // Popup progress via syncPhase; tombol ↻ tetap punya warna via syncStatus.
  const handleQuickSync = async (rebuild = false) => {
    if (syncStatus === 'syncing') return
    setSyncStatus('syncing')
    setSyncPhase({ kind: 'syncing' })
    try {
      const res = await fetch(`/api/sync-templates${rebuild ? '?rebuild=1' : ''}`, { method: 'POST' })
      if (!res.ok) {
        setSyncStatus('err')
        setSyncPhase({ kind: 'error', message: 'Server menolak sync (cek PocketBase & env).' })
        return
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')
      const decoder = new TextDecoder()
      let buffer = ''
      let d: any = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.substring(6))
            if (data.kind === 'progress') {
              setSyncPhase({ kind: 'syncing', message: data.message, current: data.current, total: data.total, name: data.name })
            } else if (data.ok === false) {
              setSyncStatus('err')
              setSyncPhase({ kind: 'error', message: data.error || 'Terjadi kesalahan.' })
              return
            } else if (data.ok === true) {
              d = data
            }
          }
        }
      }

      if (!d) throw new Error('Incomplete response')

      const pbUrl = localConfig.pocketbase_url ?? 'http://localhost:8090'
      const results = await fetchPocketBaseTemplates(pbUrl)
      // ponytail: jangan overwrite list dengan [] kalau fetch gagal/timeout — mending keep yang lama
      if (results.length > 0) onRefreshTemplates?.(results)
      setSyncStatus('ok')
      setSyncPhase({
        kind: 'done',
        result: {
          added: d.added ?? 0, cropped: d.cropped ?? 0, deleted: d.deleted ?? 0,
          detectDown: d.detectDown ?? false, skipped: d.skipped ?? [],
          loaded: results.length,
        },
      })
    } catch {
      setSyncStatus('err')
      setSyncPhase({ kind: 'error', message: 'Tidak bisa terhubung. Pastikan PocketBase menyala.' })
    }
  }
  const showSync = (screenKey === 'category' || screenKey === 'template') && localConfig.engine_mode !== 'print_local'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'g' || e.key === 'G') setGridDebug(v => !v) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const prev = useRef({ key: screenKey, children })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // sync children updates (state changes within same screen)
  if (screenKey === prev.current.key && children !== prev.current.children) {
    prev.current.children = children
    setPages([{ key: screenKey, node: children, anim: 'none' }])
  }

  useLayoutEffect(() => {
    if (screenKey === prev.current.key) return
    if (timer.current) clearTimeout(timer.current)

    const enterAnim = direction === 'forward' ? 'slide-in-right var(--dur-screen) var(--ease-out) both' : 'slide-in-left var(--dur-screen) var(--ease-out) both'
    const exitAnim  = direction === 'forward' ? 'slide-out-left var(--dur-screen) var(--ease-in) both'  : 'slide-out-right var(--dur-screen) var(--ease-in) both'

    setPages([
      { key: prev.current.key, node: prev.current.children, anim: exitAnim },
      { key: screenKey, node: children, anim: enterAnim },
    ])

    prev.current = { key: screenKey, children }

    timer.current = setTimeout(() => {
      setPages([{ key: screenKey, node: children, anim: 'none' }])
      timer.current = null
    }, 360) // ponytail: 10ms buffer over --dur-screen (350ms)
  }, [screenKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ponytail: RTL = set document dir for Arabic. Text reads correctly; if the fixed
  // .screen-split columns look mirrored-wrong in ar, per-screen RTL layout is a backlog item.
  const locale = localConfig.locale ?? 'myth-en' // default booth = Dark Myth (EN); operator bisa ganti di Settings
  useEffect(() => {
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = locale.replace('myth-', '')
  }, [locale])

  return (
    <LocaleProvider locale={locale}>
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <filter id="noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves={3} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feBlend in="SourceGraphic" mode="overlay" result="blend" />
          <feComposite in="blend" in2="SourceGraphic" operator="in" />
        </filter>
      </svg>

      {/* Blobs */}
      <div className="blob-group" style={{ filter: 'url(#noise)' }}>
        <div className="blob blob-1" /><div className="blob blob-2" />
        <div className="blob blob-3" /><div className="blob blob-4" />
      </div>

      {/* Retro grid */}
      <div className="retro-grid">
        <div className="retro-grid-inner"><div className="retro-grid-lines" /></div>
      </div>

      {/* Glass card — konten full height, padding 20px (inset header/footer dibuang) */}
      <div className="glass-wrap">
        <div className="glass-border">
          <div className="glass">
            <div style={{ position: 'absolute', inset: 'var(--pad-screen)', overflow: 'hidden' }}>
              {pages.map(p => (
                <div key={p.key} style={{ position: 'absolute', inset: 0, willChange: 'transform', animation: p.anim }}>
                  {p.node}
                </div>
              ))}
            </div>

            {/* ponytail: debug grid overlay — G key toggle, dev only */}
            {gridDebug && (
              <div style={{ position: 'absolute', inset: 'var(--pad-screen)', pointerEvents: 'none', zIndex: 50 }}>
                {/* kolom kiri */}
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%', border: '1px dashed rgba(99,255,150,0.5)', background: 'rgba(99,255,150,0.04)' }}>
                  <span style={{ position: 'absolute', top: 6, left: 8, fontSize: 'var(--text-2xs)', color: 'rgba(99,255,150,0.8)', fontFamily: 'var(--font-ui)' }}>A — title / actions</span>
                </div>
                {/* kolom kanan */}
                <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: '50%', border: '1px dashed rgba(99,180,255,0.5)', background: 'rgba(99,180,255,0.04)' }}>
                  <span style={{ position: 'absolute', top: 6, right: 8, fontSize: 'var(--text-2xs)', color: 'rgba(99,180,255,0.8)', fontFamily: 'var(--font-ui)' }}>B — content</span>
                </div>
                {/* garis tengah */}
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'rgba(255,80,80,0.7)' }} />
                <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 'var(--text-2xs)', color: 'rgba(255,80,80,0.9)', fontFamily: 'var(--font-ui)', background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: 4 }}>CENTER</span>
                {/* 1440 band — batas clamp landscape .screen-split (min(1440px,100%) ketengah) */}
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 'min(1440px, 100%)', border: '1px dashed rgba(255,200,80,0.8)' }}>
                  <span style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', fontSize: 'var(--text-2xs)', color: 'rgba(255,200,80,0.95)', fontFamily: 'var(--font-ui)', background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>1440 band</span>
                  {/* X diagonal — half kiri (A) & kanan (B), di dalam 1440 band */}
                  <svg style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%', height: '100%', overflow: 'visible' }} preserveAspectRatio="none">
                    <line x1="0" y1="0" x2="100%" y2="100%" stroke="rgba(99,255,150,0.2)" strokeWidth="1" />
                    <line x1="100%" y1="0" x2="0" y2="100%" stroke="rgba(99,255,150,0.2)" strokeWidth="1" />
                  </svg>
                  <svg style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: '50%', height: '100%', overflow: 'visible' }} preserveAspectRatio="none">
                    <line x1="0" y1="0" x2="100%" y2="100%" stroke="rgba(99,180,255,0.2)" strokeWidth="1" />
                    <line x1="100%" y1="0" x2="0" y2="100%" stroke="rgba(99,180,255,0.2)" strokeWidth="1" />
                  </svg>
                  {/* garis horizontal tengah — di dalam 1440 band */}
                  <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: 'rgba(255,80,80,0.7)' }} />
                </div>
              </div>
            )}

            {/* Gear icon — top left, opacity 50% */}
            <button
              onClick={() => setSettingsOpen(v => !v)}
              style={{
                position: 'absolute', top: 14, left: 14, zIndex: 30,
                width: 32, height: 32, borderRadius: 'var(--radius-glass)', border: 'none',
                background: 'transparent', cursor: 'pointer',
                opacity: 0.5, color: '#fff', fontSize: 'var(--text-base)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
            >
              ⚙️
            </button>

            {/* Quick Sync — top right, cuma di category & template. Mirror gear kiri. */}
            {showSync && (
              <button
                // WAJIB dibungkus arrow. `onClick={handleQuickSync}` bikin React ngirim
                // MouseEvent ke parameter `rebuild` → selalu truthy → tombol ini diam-diam
                // jalanin REBUILD (wipe semua template lalu add ulang), bukan sync ringan.
                onClick={() => handleQuickSync(false)}
                disabled={syncStatus === 'syncing'}
                title="Sync templates"
                style={{
                  position: 'absolute', top: 14, right: 14, zIndex: 30,
                  width: 32, height: 32, borderRadius: 'var(--radius-glass)', border: 'none',
                  background: 'transparent', cursor: syncStatus === 'syncing' ? 'default' : 'pointer',
                  opacity: 0.5, fontSize: 'var(--text-base)',
                  color: syncStatus === 'ok' ? '#a3be8c' : syncStatus === 'err' ? '#ff6b6b' : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'opacity 0.2s, color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
              >
                <span style={{ display: 'inline-block', animation: syncStatus === 'syncing' ? 'sync-spin 0.8s linear infinite' : 'none' }}>↻</span>
              </button>
            )}

            {/* Sync progress popup — muncul saat quick-sync, informatif hasil */}
            <SyncProgress
              phase={syncPhase}
              onClose={() => { setSyncPhase(null); setSyncStatus('idle') }}
            />

            {/* Settings panel — slide in dari kanan */}
            <SettingsPanel
              open={settingsOpen}
              onClose={() => setSettingsOpen(false)}
              config={localConfig}
              pause={pause}
              resume={resume}
              onRefreshTemplates={onRefreshTemplates}
              onQuickSync={() => handleQuickSync(false)}
              onRebuild={() => handleQuickSync(true)}
              onConfigSaved={updated => { setLocalConfig(c => ({ ...c, ...updated })); onConfigChange?.(updated) }}
            />

            {/* Industrial corner rivets — 4 dot kaca 5px di sudut (dalam padding 20px) */}
            {[
              { top: 10, left: 10 },
              { top: 10, right: 10 },
              { bottom: 10, left: 10 },
              { bottom: 10, right: 10 },
            ].map((pos, i) => (
              <span key={i} style={{
                position: 'absolute', ...pos,
                width: 5, height: 5, borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.55), rgba(255,255,255,0.08))',
                boxShadow: 'inset 0 0 1px rgba(255,255,255,0.5), 0 1px 2px rgba(0,0,0,0.35)',
                pointerEvents: 'none', zIndex: 5,
              }} />
            ))}
          </div>
        </div>
      </div>

      {/* Brand chrome — DI LUAR glass, nyelip di pojok layar. Logo 50px tinggi.
          Spin atas-tengah (klik → RESET). Epic kiri-bawah & footnote kanan-bawah
          sejajar kiri/kanan glass (pakai padding glass-wrap yg sama). */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
        <img src={localConfig.logo_url ?? '/spin.png'} alt="Spin" onClick={onLogoClick} style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', height: 50, width: 'auto', pointerEvents: onLogoClick ? 'auto' : 'none', cursor: onLogoClick ? 'pointer' : 'default' }} />
        <img src={EPIC_LOGO} alt="Epic" style={{ position: 'absolute', bottom: 20, left: 'clamp(24px, 10vmin, 80px)', height: 50, width: 'auto' }} />
        <p style={{ position: 'absolute', bottom: 40, right: 'clamp(24px, 10vmin, 80px)', textAlign: 'right', fontSize: 'var(--text-2xs)', color: 'white', lineHeight: '13px', fontFamily: 'var(--font-ui)' }}>
          spindonesia | epicyoung ® software<br />all rights reserved © 2026
        </p>
      </div>
    </LocaleProvider>
  )
}

'use client'
import { useState, useEffect, useRef, type Dispatch } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { TouchButton } from '@/components/ui/TouchButton'
import type { KioskAction, KioskState, KioskConfig } from '@/lib/types'
import { findLandscapePair, loadImageDims, orientationOf, type OrientedFrame } from '@/lib/frames'
import { printPhoto } from '@/lib/print'
import { compositeFrame } from '@/lib/frame-composite'
import { uploadAsset } from '@/lib/upload'
import { useT } from '@/lib/i18n'

type Props = {
  // choose = frame chooser (cycling + Back/Next, no upload/print). final = preview (fixed frame, upload+print).
  mode: 'choose' | 'final'
  state: Extract<KioskState, { screen: 'preview' | 'framechooser' }>
  dispatch: Dispatch<KioskAction>
  frames: OrientedFrame[]
  config: Pick<KioskConfig, 'enable_email' | 'enable_print' | 'enable_video'>
  licensed: boolean
  eventName: string
  onAction?: (action: 'printed' | 'emailed' | 'shared') => void
}

function TabSwitcher({ activeTab, videoUrl, videoLoading, onSwitch }: {
  activeTab: 'photo' | 'video'
  videoUrl: string | null
  videoLoading: boolean
  onSwitch: (tab: 'photo' | 'video') => void
}) {
  return (
    <div style={{ display: 'flex', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(12px)', borderRadius: 10, padding: 3, gap: 3 }}>
      {(['photo', 'video'] as const).map(tab => (
        <button key={tab}
          onClick={() => tab === 'video' && !videoUrl ? undefined : onSwitch(tab)}
          style={{
            padding: '6px 20px', borderRadius: 7, border: 'none',
            cursor: tab === 'video' && !videoUrl ? 'default' : 'pointer',
            fontFamily: 'var(--font-ui)', fontSize: 'var(--text-xs)', fontWeight: 500,
            letterSpacing: '0.08em', textTransform: 'uppercase', transition: 'all 0.2s',
            background: activeTab === tab ? 'rgba(255,255,255,0.2)' : 'transparent',
            color: activeTab === tab ? '#fff' : tab === 'video' && !videoUrl ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.5)',
          }}
        >
          {tab === 'video' && videoLoading
            ? <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />Video</span>
            : tab.charAt(0).toUpperCase() + tab.slice(1)}
        </button>
      ))}
    </div>
  )
}

const VIDEO_QR_URL = process.env.NEXT_PUBLIC_KIOSK_URL ? `${process.env.NEXT_PUBLIC_KIOSK_URL}/#liveview-video` : '/#liveview-video'

export function PreviewScreen({ mode, state, dispatch, frames, config, licensed, eventName, onAction }: Props) {
  const isChoose = mode === 'choose'
  const isFinal = mode === 'final'
  const t = useT()
  const [showOriginal, setShowOriginal] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [qrStatus, setQrStatus] = useState<'idle' | 'uploading' | 'failed'>('idle')
  const uploadSeq = useRef(0)
  const [printing, setPrinting] = useState(false)
  const [frameIdx, setFrameIdx] = useState<number | null>(
    frames.some(f => f.orientation === 'portrait') ? 1 : null)
  const [qty, setQty] = useState<number | null>(null)
  const [emailMode, setEmailMode] = useState(false)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [showVideoConfirm, setShowVideoConfirm] = useState(false)
  const [videoLoading, setVideoLoading] = useState(false)
  const [videoProgress, setVideoProgress] = useState(0)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'photo' | 'video'>('photo')
  const inputRef = useRef<HTMLInputElement>(null)
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cycling cuma pool portrait (frame foto AI). Landscape dipake via pairing di tab Original.
  const allFrames = frames.filter(f => f.orientation === 'portrait')
  const cyclingFrame = frameIdx === null ? null : allFrames[frameIdx - 1] ?? null
  // Choose = frame lagi dipilih (cycling). Final = frame kepilih dari framechooser (fixed by id, no index drift).
  const chosenFrameId = state.screen === 'preview' ? state.selectedFrame?.id ?? null : null
  const currentFrame = isChoose ? cyclingFrame : (chosenFrameId ? frames.find(f => f.id === chosenFrameId) ?? null : null)
  // frameIdx: null = no frame, 1-based index into allFrames
  function prevFrame() { setFrameIdx(i => i === null ? allFrames.length : i <= 1 ? allFrames.length : i - 1) }
  function nextFrame() { setFrameIdx(i => i === null ? 1 : i >= allFrames.length ? 1 : i + 1) }

  // Orientasi asli foto — mismatch = original beda orientasi dari hasil AI (AI = bentuk template).
  const [origDims, setOrigDims] = useState<{ w: number; h: number } | null>(null)
  const [aiDims, setAiDims] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    let live = true
    if (state.originalUrl) loadImageDims(state.originalUrl).then(d => { if (live) setOrigDims(d) })
    if (state.aiUrl) loadImageDims(state.aiUrl).then(d => { if (live) setAiDims(d) })
    return () => { live = false }
  }, [state.originalUrl, state.aiUrl])

  const mismatch = !!origDims && !!aiDims &&
    orientationOf(origDims.w, origDims.h) !== orientationOf(aiDims.w, aiDims.h)
  const pairedLandscape = findLandscapePair(frames, currentFrame)
  // Frame yang tampil di view aktif: Original-mismatch -> pasangan landscape (bisa null = polos)
  const visibleFrame = showOriginal && mismatch ? pairedLandscape : currentFrame
  // Box Original-mismatch snap ke aspect ASLI foto -> object-cover = exact fit, zero crop
  const showNative = showOriginal && mismatch && activeTab === 'photo'

  const printUrl = showOriginal ? state.originalUrl : state.aiUrl

  async function doPrint(url: string, frameUrl: string | null, copies: number) {
    // Burn frame ke foto full-res sebelum print — DOM overlay ga ikut ke printer.
    // compositeFrame passthrough kalau frameUrl null. Gagal composite → print foto polos.
    let out = url
    try {
      out = await compositeFrame(url, frameUrl)
    } catch (err) {
      console.warn('[print] composite frame gagal, print foto polos:', err)
    }
    await printPhoto(out, copies)
  }

  function handlePrintBtn() {
    if (qty === null) { setQty(1); return }
    setPrinting(true)
    setQty(null)
    onAction?.('printed')
    doPrint(printUrl, visibleFrame?.url ?? null, qty ?? 1)
  }
  function onPrintAnimEnd() { setPrinting(false) }

  function handleEmailBtn() {
    setEmailMode(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function handleEmailSend() {
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEmailError(true); return }
    const aiUrl = state.aiUrl
    await fetch('/api/send-email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: email, photo_url: aiUrl }),
    })
    setEmailMode(false)
    setEmail('')
    setEmailSent(true)
    onAction?.('emailed')
    setTimeout(() => setEmailSent(false), 4000)
  }

  function handleVideoConfirmOk() {
    setShowVideoConfirm(false)
    setVideoLoading(true)
    setVideoProgress(0)
  }

  // ponytail: fake progress bar + done after 4s, replace with real API polling later
  useEffect(() => {
    if (!videoLoading) return
    const interval = setInterval(() => {
      setVideoProgress(p => p >= 95 ? 95 : p + Math.random() * 8)
    }, 300)
    const done = setTimeout(() => {
      clearInterval(interval)
      setVideoProgress(100)
      setTimeout(() => {
        setVideoLoading(false)
        setVideoUrl('/video.mp4')
        setActiveTab('video')
      }, 400)
    }, 4000)
    return () => { clearInterval(interval); clearTimeout(done) }
  }, [videoLoading])

  // R2 upload + QR — frame di-burn dulu ke foto (branding ikut ke share), lalu A+B naik.
  // Ganti frame = re-upload key R2 yang SAMA (overwrite) → URL QR stabil, QR ga kedip.
  // RAW (sourceUrl/rawAiUrl) yang dikirim: worker yang mutusin watermark server-side.
  // Unlicensed: no upload — QR = sinyal sesi berbayar (decoy di JSX bawah).
  const frameForOriginal = mismatch ? pairedLandscape : currentFrame
  // Upload A(Original)+B(AI) ke R2, dua-duanya frame kepilih di-burn dulu → QR ke microsite.
  // attempts: auto-retry (effect) 2x; manual (tombol Ulangi QR) 1x. Guard uploadSeq = frame
  // paling baru yang menang, QR ga ketimpa hasil upload lama.
  async function runUpload(attempts: number) {
    if (!licensed || !state.base) return
    const base = state.base
    const seq = ++uploadSeq.current
    const rawOriginal = state.sourceUrl ?? state.originalUrl
    const rawAi = state.rawAiUrl ?? state.aiUrl
    const meta = { eventName, durationSec: state.processingSec }
    setQrStatus('uploading')
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const [framedA, framedB] = await Promise.all([
          compositeFrame(rawOriginal, frameForOriginal?.url ?? null, 1200),
          compositeFrame(rawAi, currentFrame?.url ?? null, 1200),
        ])
        const [, resB] = await Promise.all([
          uploadAsset(framedA, 'A', base, meta),
          uploadAsset(framedB, 'B', base, meta),
        ])
        if (uploadSeq.current === seq) {
          setShareUrl(`https://semeta-microsite.pages.dev/s?b=${encodeURIComponent(resB.key)}`)
          setQrStatus('idle')
        }
        return
      } catch (err) {
        console.error(`[preview] upload R2 gagal (attempt ${attempt + 1}):`, err)
        if (attempt < attempts - 1) await new Promise(r => setTimeout(r, 3000))
      }
    }
    if (uploadSeq.current === seq) setQrStatus('failed')
  }

  useEffect(() => {
    if (!isFinal || !licensed || !state.base) return // upload cuma di preview final, frame udah fixed
    const debounce = setTimeout(() => { runUpload(2) }, 600)
    return () => clearTimeout(debounce)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFinal, licensed, state.base, currentFrame?.url, frameForOriginal?.url])

  const qrValue = activeTab === 'video' ? VIDEO_QR_URL : shareUrl

  return (
    <div className="screen-split screen-split--center flex flex-col w-full h-full" style={{ overflow: 'clip' }}>
      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1 className="h1-glow" style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>
          {t(isChoose ? 'preview_title' : 'delivery_title') as string}
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618, whiteSpace: 'pre-line' }}>
          {t(isChoose ? 'preview_subtitle' : 'delivery_subtitle') as string}
        </p>
      </div>

      <div className="screen-content">
        {/* Tab switcher portrait-only — di atas foto, normal flow. Video cuma di preview final. */}
        {isFinal && (
          <div className="preview-tab-switcher" style={{ justifyContent: 'center', paddingBottom: 10 }}>
            <TabSwitcher activeTab={activeTab} videoUrl={videoUrl} videoLoading={videoLoading} onSwitch={setActiveTab} />
          </div>
        )}

        {/* Media area — position:relative jadi anchor tab switcher landscape */}
        <div className="flex-1 min-h-0 flex items-center justify-center gap-3" style={{ padding: 4, position: 'relative' }}>
          {/* Tab switcher landscape-only — absolute top-center di atas foto, di luar overflow:hidden */}
          {isFinal && (
            <div className="preview-tab-switcher-landscape" style={{ position: 'absolute', top: 35, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }}>
              <TabSwitcher activeTab={activeTab} videoUrl={videoUrl} videoLoading={videoLoading} onSwitch={setActiveTab} />
            </div>
          )}
        {activeTab === 'photo' && isChoose && (
          <button onClick={prevFrame} className="glass-btn" style={{ flexShrink: 0, width: 48, height: 48, fontSize: 'var(--text-xl)', padding: 0 }}>‹</button>
        )}
        <div
          className={`preview-media${showNative && origDims ? ' preview-media--native' : ''}`}
          style={showNative && origDims ? { '--native-ratio': `${origDims.w} / ${origDims.h}` } as React.CSSProperties : undefined}
        >

          {/* Media layer */}
          {activeTab === 'photo' ? (
            <div
              className={`absolute inset-0 cursor-pointer${printing ? '' : ' animate-photo-reveal-inner'}`}
              style={{ animation: printing ? 'print-eject 1200ms ease-in-out' : undefined }}
              onClick={() => setShowOriginal(v => !v)}
              onAnimationEnd={onPrintAnimEnd}
            >
              {state.aiUrl
                ? <img src={state.aiUrl} alt="AI result" className="absolute inset-0 w-full h-full object-cover" />
                : <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.04)' }} />
              }
              {state.originalUrl && (
                <img src={state.originalUrl} alt="Original" className="absolute inset-0 w-full h-full object-cover z-10"
                  style={{ opacity: showOriginal ? 1 : 0, transition: 'opacity 0.3s ease' }} />
              )}
              {visibleFrame && <img src={visibleFrame.url} alt="Frame" className="absolute inset-0 w-full h-full object-cover pointer-events-none z-20" />}
            </div>
          ) : (
            <div className="absolute inset-0 animate-fade-in" style={{ background: '#000' }}>
              {videoUrl
                ? <video src={videoUrl} autoPlay loop playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                : <div className="absolute inset-0 flex items-center justify-center"><p style={{ color: 'var(--fg-muted)', fontSize: 'var(--text-sm)' }}>{t('preview_generating') as string}</p></div>
              }
              {currentFrame && <img src={currentFrame.url} alt="Frame" className="absolute inset-0 w-full h-full object-cover pointer-events-none z-20" />}
            </div>
          )}



          {/* Light sweep + sparkle glint every 6s — glosses over both AI & Original */}
          {activeTab === 'photo' && (
            <div className="preview-shine" aria-hidden="true">
              <span className="shine-haze" />
              <span className="shine-core" />
              <i className="spark" style={{ top: '20%', left: '24%', width: 26, height: 26, animationDelay: '0.25s' }} />
              <i className="spark" style={{ top: '60%', left: '55%', width: 16, height: 16, animationDelay: '0.4s' }} />
              <i className="spark" style={{ top: '38%', left: '78%', width: 20, height: 20, animationDelay: '0.5s' }} />
            </div>
          )}

          {/* QR — top right. Real bila licensed + URL siap; decoy "nonaktif" bila freeware
              (QR = fitur berbayar). Decoy diutamakan biar licensed yg lagi upload ga keliatan mati.
              QR cuma di preview final — frame chooser belum upload apa-apa. */}
          {isFinal && (!licensed ? (
            <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 40, padding: 6, borderRadius: 10, background: 'white', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
              <div style={{ position: 'relative', width: 80, height: 80 }}>
                {/* QR boongan — pola asli ketutup label, keliatan "ada tapi mati" */}
                <QRCodeSVG value="https://spindonesia.id" size={80} bgColor="white" fgColor="#090135" />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,1)', borderRadius: 4, padding: 3 }}>
                  <span style={{ fontSize: 7, lineHeight: 1.3, fontWeight: 600, color: '#090135', textAlign: 'center' }}>
                    QR fitur nonaktif — hub admin
                  </span>
                </div>
              </div>
            </div>
          ) : qrValue ? (
            <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 40, padding: 6, borderRadius: 10, background: 'white', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
              <QRCodeSVG value={qrValue} size={80} bgColor="white" fgColor="#090135" />
            </div>
          ) : activeTab === 'photo' && (qrStatus === 'uploading' || qrStatus === 'failed') ? (
            // Upload R2 belum kelar / gagal (offline). Operator bisa tap buat re-upload manual.
            <button
              onClick={() => { if (qrStatus !== 'uploading') runUpload(1) }}
              disabled={qrStatus === 'uploading'}
              style={{ position: 'absolute', top: 12, right: 12, zIndex: 40, width: 92, height: 92, padding: 6, borderRadius: 10, background: 'white', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', cursor: qrStatus === 'uploading' ? 'default' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              {qrStatus === 'uploading' ? (
                <>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', border: '3px solid rgba(9,1,53,0.15)', borderTopColor: '#090135', animation: 'spin 0.8s linear infinite' }} />
                  <span style={{ fontSize: 8, fontWeight: 600, color: '#090135', letterSpacing: '0.04em' }}>Mengunggah…</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 20, lineHeight: 1, color: '#090135' }}>↻</span>
                  <span style={{ fontSize: 8, lineHeight: 1.25, fontWeight: 700, color: '#090135', textAlign: 'center' }}>Ulangi<br />QR</span>
                </>
              )}
            </button>
          ) : null)}

          {/* AI/Original badge — top left */}
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 40, fontSize: 'var(--text-2xs)', letterSpacing: '0.2em', textTransform: 'uppercase', background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)', padding: '4px 10px', borderRadius: 'var(--radius-chip)', backdropFilter: 'blur(8px)' }}>
            {activeTab === 'video' ? 'Video' : showOriginal ? 'Original' : 'AI'}
          </div>

          {/* Tap hint — bottom center */}
          {activeTab === 'photo' && (
            <div className="absolute bottom-3 inset-x-0 flex justify-center pointer-events-none" style={{ zIndex: 40 }}>
              <span style={{ fontSize: 'var(--text-2xs)', letterSpacing: '0.2em', textTransform: 'uppercase', background: 'rgba(0,0,0,0.55)', color: 'var(--fg-muted)', padding: '6px 14px', borderRadius: 'var(--radius-chip)' }}>
                {showOriginal ? t('preview_tap_see_ai') as string : t('preview_tap_compare') as string}
              </span>
            </div>
          )}
        </div>
        {activeTab === 'photo' && isChoose && (
          <button onClick={nextFrame} className="glass-btn" style={{ flexShrink: 0, width: 48, height: 48, fontSize: 'var(--text-xl)', padding: 0 }}>›</button>
        )}
        </div>
      </div>

      {/* Footer — 5 tombol; di landscape wrap 2/baris di kolom kiri */}
      <div className="screen-actions shrink-0 p-5">
        {/* Video progress — portrait: antara foto & tombol, landscape: atas tombol di kolom kiri */}
        {videoLoading && (
          <div style={{ paddingBottom: 12 }}>
            <div style={{ height: 2, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, var(--brand), #00f5d4)', width: `${videoProgress}%`, transition: 'width 0.7s ease' }} />
            </div>
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-muted)', letterSpacing: '0.1em', marginTop: 4, display: 'block' }}>{t('preview_generating_video') as string} {Math.round(videoProgress)}%</span>
          </div>
        )}
        {/* Expanded print panel — full width takeover */}
        {qty !== null && (
          <div className="preview-expand-backdrop" onClick={() => setQty(null)}>
            <div className="preview-expand-panel" onClick={e => e.stopPropagation()}>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', marginBottom: 16, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{t('preview_print_qty_label') as string}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'rgba(255,255,255,0.06)', borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
                <button onClick={() => setQty(q => Math.max(1, (q ?? 1) - 1))} style={{ flex: 1, padding: '18px 0', fontSize: 'var(--text-xl)', color: '#fff', background: 'none', border: 'none', cursor: 'pointer' }}>−</button>
                <span style={{ flex: 1, textAlign: 'center', fontSize: 'var(--text-2xl)', fontWeight: 600, color: '#fff', fontFamily: 'var(--font-ui)' }}>{qty}</span>
                <button onClick={() => setQty(q => (q ?? 1) + 1)} style={{ flex: 1, padding: '18px 0', fontSize: 'var(--text-xl)', color: '#fff', background: 'none', border: 'none', cursor: 'pointer' }}>+</button>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <TouchButton variant="secondary" onClick={() => setQty(null)} className="flex-1">{t('preview_print_cancel') as string}</TouchButton>
                <TouchButton onClick={handlePrintBtn} className="flex-1">{printing ? t('preview_printing') as string : `${t('preview_print_btn') as string} ${qty}x`}</TouchButton>
              </div>
            </div>
          </div>
        )}

        {/* Expanded email panel — full width takeover */}
        {emailMode && (
          <div className="preview-expand-backdrop" onClick={() => { setEmailMode(false); setEmail(''); setEmailError(false) }}>
            <div className="preview-expand-panel" onClick={e => e.stopPropagation()}>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', marginBottom: 16, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{t('preview_email_label') as string}</p>
              <div style={{ position: 'relative', marginBottom: 20 }}>
                {emailError && (
                  <span style={{ position: 'absolute', top: -20, left: 4, fontSize: 'var(--text-2xs)', color: '#ff6b6b' }}>{t('preview_email_invalid') as string}</span>
                )}
                <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.08)', border: `1px solid ${emailError ? '#ff6b6b' : 'rgba(255,255,255,0.15)'}`, borderRadius: 14, padding: '0 16px', transition: 'border-color 0.2s' }}>
                  <input
                    ref={inputRef}
                    value={email}
                    onChange={e => { setEmail(e.target.value); setEmailError(false) }}
                    onKeyDown={e => { if (e.key === 'Enter') handleEmailSend(); if (e.key === 'Escape') { setEmailMode(false); setEmail(''); setEmailError(false) } }}
                    placeholder={t('preview_email_placeholder') as string}
                    style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 'var(--text-base)', fontFamily: 'var(--font-ui)', outline: 'none', color: '#fff', padding: '16px 0', caretColor: 'white' }}
                  />
                  {email && (
                    <button onClick={handleEmailSend} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', color: 'rgba(255,255,255,0.8)', fontSize: 'var(--text-lg)', flexShrink: 0 }}>➤</button>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <TouchButton variant="secondary" onClick={() => { setEmailMode(false); setEmail(''); setEmailError(false) }} className="flex-1">{t('preview_email_cancel') as string}</TouchButton>
                <TouchButton onClick={handleEmailSend} className="flex-1">{t('preview_email_send') as string}</TouchButton>
              </div>
            </div>
          </div>
        )}

        {isChoose ? (
          // Frame chooser footer — Back (re-pilih template) + Next (bawa frame ke preview).
          <div className="screen-actions-row flex gap-3">
            <TouchButton variant="secondary" onClick={() => dispatch({ type: 'BACK' })} className="flex-1">
              {t('nav_back') as string}
            </TouchButton>
            <TouchButton onClick={() => dispatch({ type: 'CONFIRM_FRAME', frame: currentFrame })} className="flex-1">
              {t('nav_next') as string}
            </TouchButton>
          </div>
        ) : (
        <div className="screen-actions-row flex gap-3">
          {config.enable_print && (
            <TouchButton onClick={() => setQty(1)} className="flex-1" disabled={printing}>
              {printing ? t('preview_printing') as string : t('preview_btn_print') as string}
            </TouchButton>
          )}
          {config.enable_email && (
            <TouchButton onClick={handleEmailBtn} className="flex-1" disabled={printing}>{t('preview_btn_email') as string}</TouchButton>
          )}
          {config.enable_video && (
            <TouchButton onClick={() => setShowVideoConfirm(true)} className="flex-1" disabled={printing || videoLoading || !!videoUrl}>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2 }}>
                <span style={{ fontSize: 'var(--text-sm)' }}>{videoUrl ? t('preview_btn_video_ready') as string : videoLoading ? t('preview_generating') as string : t('preview_btn_make_video') as string}</span>
                {!videoUrl && !videoLoading && <span style={{ fontSize: 'var(--text-2xs)', opacity: 0.55, fontWeight: 400 }}>{t('preview_video_cost_note') as string}</span>}
              </span>
            </TouchButton>
          )}
          <TouchButton variant="secondary" onClick={() => dispatch({ type: 'BACK' })} className="flex-1" disabled={printing}>
            {t('preview_btn_rechoose') as string}
          </TouchButton>
          <TouchButton variant="secondary" onClick={() => dispatch({ type: 'RESET' })} className="flex-1" disabled={printing}>
            {t('preview_btn_restart') as string}
          </TouchButton>
        </div>
        )}
      </div>

      {/* Email sent celebration popup */}
      {emailSent && (
        <div
          className="animate-fade-in"
          style={{ position: 'absolute', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(9,1,53,0.6)', backdropFilter: 'blur(8px)', pointerEvents: 'none' }}
        >
          <div
            className="animate-fade-in"
            style={{ background: 'rgba(20,10,70,0.95)', border: '1px solid var(--border-dialog)', borderRadius: 'var(--radius-preview)', padding: '48px 44px', maxWidth: 400, width: '80%', textAlign: 'center', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}
          >
            <div style={{ fontSize: 'var(--text-3xl)', marginBottom: 16 }}>📬</div>
            <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, marginBottom: 12, letterSpacing: '-0.02em' }}>{t('preview_email_sent_title') as string}</h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)', lineHeight: 1.7 }}>
              {t('preview_email_sent_body') as string}
            </p>
          </div>
        </div>
      )}

      {/* Make Video confirm dialog */}
      {showVideoConfirm && (
        <div
          className="animate-fade-in"
          style={{ position: 'absolute', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(9,1,53,0.7)', backdropFilter: 'blur(8px)' }}
          onClick={() => setShowVideoConfirm(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'rgba(20,10,70,0.92)', border: '1px solid var(--border-dialog)', borderRadius: 'var(--radius-dialog)', padding: '40px 36px', maxWidth: 420, width: '80%', textAlign: 'center', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}
          >
            <div style={{ fontSize: 'var(--text-2xl)', marginBottom: 16 }}>🎬</div>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 12, letterSpacing: '-0.02em' }}>{t('preview_video_dialog_title') as string}</h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)', lineHeight: 1.6, marginBottom: 32 }}>
              {t('preview_video_dialog_body') as string}
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <TouchButton onClick={handleVideoConfirmOk} className="flex-1">{t('preview_video_dialog_ok') as string}</TouchButton>
              <TouchButton variant="secondary" onClick={() => setShowVideoConfirm(false)} className="flex-1">{t('preview_video_dialog_cancel') as string}</TouchButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


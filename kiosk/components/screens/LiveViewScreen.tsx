'use client'
import { useEffect, useRef, useState, useCallback, type Dispatch, type CSSProperties } from 'react'
import { TouchButton } from '@/components/ui/TouchButton'
import { stopCamera, triggerCanonCapture, rotateDataUrl } from '@/lib/camera'
import type { KioskAction, KioskState } from '@/lib/types'
import { useT } from '@/lib/i18n'

type Props = {
  state: Extract<KioskState, { screen: 'liveview' }>
  dispatch: Dispatch<KioskAction>
  cameraSource?: string
}

// pure: source dims + rotasi → ukuran canvas output. Quarter-turn (90/270) tuker w/h.
// Dipake display & capture biar sinkron. Lihat rotatedSize.test.mjs buat self-check.
export function rotatedSize(vw: number, vh: number, rotation: number) {
  return rotation === 90 || rotation === 270 ? { w: vh, h: vw } : { w: vw, h: vh }
}

const ROT_KEY = 'semeta.cameraRotation'
// Live preview lewat backend proxy (same-origin, no CORS) — /api/canon-live auto-start liveview
// + proxy 1 JPEG frame dari digiCamControl. <img> re-fetch tiap CANON_LIVE_MS jadi live-ish.
// (Dulu nunjuk 5514/live langsung → ERR_CONNECTION_REFUSED + CORS.)
export const CANON_LIVE = '/api/canon-live'
export const CANON_LIVE_MS = 200

export function LiveViewScreen({ dispatch, cameraSource }: Props) {
  const t = useT()
  const isCanon = cameraSource === 'canon'
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [retry, setRetry] = useState(0) // bump = re-mount kamera (tombol "Coba Lagi")
  const [countdown, setCountdown] = useState<number | null>(null)
  const [flash, setFlash] = useState(false)
  const [captured, setCaptured] = useState<string | null>(null)
  // null = capture webcam (box ikut rotasi). Di-set pas Browse → box snap 2:3/3:2 ikut orientasi foto.
  const [browseAspect, setBrowseAspect] = useState<'portrait' | 'landscape' | null>(null)

  const [containerDims, setContainerDims] = useState<{ w: number; h: number } | null>(null)
  // ponytail: default 0. Webcam landscape bakal miring pas first boot — operator tap rotate
  // sekali (kesimpan ke localStorage, persist selamanya). Upgrade: auto-init dari aspect kalau mau.
  const [rotation, setRotation] = useState(0)

  // Load rotasi tersimpan (client-only, aman dari SSR karena di useEffect)
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(ROT_KEY))
      if ([0, 90, 180, 270].includes(saved)) setRotation(saved)
    } catch {}
  }, [])

  const rotate = useCallback(() => {
    setRotation(r => {
      const next = (r + 90) % 360 // ponytail: mau muter arah sebaliknya? ganti +90 jadi +270 — satu tempat, display+capture tetep sinkron
      try { localStorage.setItem(ROT_KEY, String(next)) } catch {}
      return next
    })
  }, [])

  // Observer ngukur kotak 50%-nya (buat swap-dimensi pas quarter-turn)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      if (entries[0]) {
        setContainerDims({ w: entries[0].contentRect.width, h: entries[0].contentRect.height })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Canon live-ish: bump tiap CANON_LIVE_MS → <img> src ganti (cache-bust) → re-fetch frame proxy.
  // Berhenti pas captured (ga perlu live pas review foto). Webcam ga kena (pakai <video> stream).
  // capturing: polling SETOP selama shutter jalan — capture route sengaja nge-Hide LV, dan
  // polling yang jalan terus bakal nge-Show LV lagi DI TENGAH shutter (race → kamera hang).
  const [capturing, setCapturing] = useState(false)
  const [liveTick, setLiveTick] = useState(0)
  useEffect(() => {
    if (!isCanon || captured || capturing) return
    const id = setInterval(() => setLiveTick(t => t + 1), CANON_LIVE_MS)
    return () => clearInterval(id)
  }, [isCanon, captured, capturing])

  useEffect(() => {
    // Canon: capture lewat backend (DSLR bukan webcam). Enable tombol; preview = proxy frame.
    // Restart LV paksa TIAP mount — abis capture LV sengaja di-Hide, dan dCC nyajiin frame
    // basi (HTTP 200) ke sesi berikutnya → tamu kedua dapet layar beku, operator klik manual.
    // Restart di sini = tiap sesi mulai dari LV seger, nol intervensi. Retry bump ikut kena.
    if (isCanon) {
      setCameraReady(true)
      fetch('/api/canon-live', { method: 'POST' }).catch(() => { /* freeze-detect jaring kedua */ })
      return
    }
    const el = videoRef.current
    if (!el) return
    let cancelled = false
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        el.srcObject = stream
        // play() bisa reject AbortError kalau ke-interrupt load baru (transisi screen / remount).
        // Itu benign — jangan dipromosiin jadi cameraError. Cuma error nyata yang ditampilin.
        el.play()
          .then(() => setCameraReady(true))
          .catch(err => { if (err?.name !== 'AbortError') setCameraError(true) })
      })
      .catch(() => { if (!cancelled) setCameraError(true) })
    return () => { cancelled = true; stopCamera(el) }
  }, [retry, isCanon])

  // Kamera gagal ≠ layar mati. Reset state + bump retry biar effect getUserMedia jalan lagi.
  const retryCamera = useCallback(() => {
    setCameraError(false)
    setCameraReady(false)
    setRetry(n => n + 1)
  }, [])

  // Restart paksa LV dCC (POST /api/canon-live) — buat frame NGEFREEZE (HTTP masih 200 →
  // self-healing ga ke-trigger). Fire-and-forget; polling 200ms nyambung sendiri abis LV bangun.
  const [lvResetting, setLvResetting] = useState(false)
  const resetLiveView = useCallback(async () => {
    setLvResetting(true)
    try { await fetch('/api/canon-live', { method: 'POST' }) } catch { /* polling recover sendiri */ }
    finally { setTimeout(() => setLvResetting(false), 800) }
  }, [])

  const handleCapture = useCallback(async () => {
    for (const n of [3, 2, 1]) {
      setCountdown(n)
      await new Promise(r => setTimeout(r, 800))
    }
    setCountdown(null)
    setFlash(true)
    await new Promise(r => setTimeout(r, 200))
    setFlash(false)
    if (isCanon) {
      // DSLR full-res dari backend, lalu rotate ikut tombol (sama kayak webcam) — DSLR ga bisa
      // diputer fisik, jadi rotasi di canvas. deg 0 = passthrough.
      setCapturing(true)
      try { const url = await rotateDataUrl(await triggerCanonCapture(), rotation); setBrowseAspect(null); setCaptured(url) }
      catch { setCameraError(true) }
      finally { setCapturing(false) }
      return
    }
    const video = videoRef.current
    if (!video) return
    const vw = video.videoWidth
    const vh = video.videoHeight
    const { w, h } = rotatedSize(vw, vh, rotation)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    // ponytail: capture = frame di-rotate penuh. Pas banget sama box 9:16 kalau kamera 16:9 di 90/270.
    // Kamera 4:3 atau mau WYSIWYG persis di tiap sudut → crop canvas ke aspect box dulu (cover-crop).
    ctx.translate(w / 2, h / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.drawImage(video, -vw / 2, -vh / 2)
    setBrowseAspect(null) // capture webcam → box balik ikut rotasi, bukan 2:3/3:2
    setCaptured(canvas.toDataURL('image/jpeg', 0.92))
  }, [rotation, isCanon])

  const handleBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const url = ev.target?.result as string
      // Ukur orientasi foto → box snap ke 2:3 (portrait) / 3:2 (landscape) biar ngisi penuh tanpa bar
      const img = new Image()
      img.onload = () => { setBrowseAspect(img.naturalHeight >= img.naturalWidth ? 'portrait' : 'landscape'); setCaptured(url) }
      img.onerror = () => { setBrowseAspect(null); setCaptured(url) } // gagal ukur → fallback box rotasi
      img.src = url
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const quarter = rotation === 90 || rotation === 270
  // Box aspect: foto Browse → snap 2:3/3:2 ikut orientasinya; else ikut rotasi kamera (live/capture webcam)
  const boxClass =
    browseAspect === 'portrait' ? 'aspect-[2/3] w-[500px] max-w-full max-h-full h-auto' // ikut box kamera portrait, ga full-height
    : browseAspect === 'landscape' ? 'aspect-[3/2] w-full h-auto max-w-full max-h-full'
    : quarter ? 'aspect-[9/16] w-[500px] max-w-full max-h-full h-auto'
    : 'aspect-video w-full max-w-full h-auto max-h-full'

  // Style live-feed dipakai bareng <video> (webcam) & <img> MJPEG (canon) — sumber beda, layout sama.
  const liveStyle: CSSProperties = {
    display: captured ? 'none' : 'block',
    width: quarter ? (containerDims ? `${containerDims.h}px` : '100vh') : '100%',
    height: quarter ? (containerDims ? `${containerDims.w}px` : '100vw') : '100%',
    objectFit: 'cover',
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  }

  return (
    <div className="screen-split flex flex-col w-full h-full overflow-hidden">

      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1 className="h1-glow" style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>
          {t('liveview_title') as string}
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618, whiteSpace: 'pre-line' }}>
          {t('liveview_subtitle') as string}
        </p>
      </div>

      <div className="screen-content">
        <div className="flex-1 min-h-0 flex items-center justify-center p-5">
        <div
          ref={containerRef}
          className={`relative overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10 ${boxClass}`}
          style={{ background: '#000' }}
        >
          {/* CUMA video/live yang muter — overlay di bawah ini sibling, jadi tetep tegak.
              Canon: MJPEG <img> dari digiCamControl. Webcam: getUserMedia <video>. */}
          {isCanon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${CANON_LIVE}?t=${liveTick}`} alt="" className="absolute top-1/2 left-1/2 max-w-none max-h-none" style={liveStyle} onLoad={() => setCameraReady(true)} onError={() => {/* frame gagal = best-effort, tombol tetep enable */}} />
          ) : (
            <video
              ref={videoRef}
              autoPlay playsInline muted
              className="absolute top-1/2 left-1/2 max-w-none max-h-none"
              style={liveStyle}
            />
          )}

          {/* Box udah nge-snap ke orientasi foto → object-cover ngisi penuh (frame look), crop minimal, ga ada bar */}
          {captured && <img src={captured} alt="captured" className="absolute inset-0 w-full h-full object-cover" />}

          {!cameraReady && !cameraError && !captured && !countdown && (
            <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: '#000' }}>
              <div style={{ width: 36, height: 36, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'var(--fg)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <p style={{ fontSize: 'var(--text-xs)', letterSpacing: '0.2em', color: 'var(--fg-muted)', marginTop: 16, textTransform: 'uppercase' }}>{t('liveview_loading_camera') as string}</p>
            </div>
          )}

          {/* Kamera gagal: overlay lembut DI DALAM box — Browse tetep jalan, layar ga ke-nuke */}
          {cameraError && !captured && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: '#000' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m1 1 22 22" />
                <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56" />
              </svg>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)', lineHeight: 1.5 }}>{t('liveview_error_body') as string}</p>
              <button onClick={retryCamera} style={{ padding: '10px 20px', borderRadius: 10, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                {t('liveview_error_retry') as string}
              </button>
            </div>
          )}

          {countdown !== null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 15 }}>
              <span key={countdown} className="animate-countdown h1-glow" style={{ fontSize: 'clamp(60px,20vw,120px)', fontWeight: 500, lineHeight: 1 }}>
                {countdown}
              </span>
              <p style={{ fontSize: 'var(--text-sm)', letterSpacing: '0.3em', color: 'var(--fg-muted)', marginTop: 12, textTransform: 'uppercase' }}>{t('liveview_smile') as string}</p>
            </div>
          )}

          {flash && <div className="absolute inset-0 bg-white z-20" />}

          {/* Tombol ROTATE (+ refresh LV khusus Canon) — cuma pas kamera live, mati pas countdown */}
          {cameraReady && !captured && (
            <div className="absolute inset-0 flex items-start justify-end p-4" style={{ zIndex: 30 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  onClick={rotate}
                  disabled={countdown !== null}
                  aria-label={t('liveview_rotate_aria') as string}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 44, height: 44, borderRadius: 12,
                    background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.3)',
                    color: '#fff', cursor: 'pointer', backdropFilter: 'blur(8px)',
                    opacity: countdown !== null ? 0.4 : 1,
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
                {/* Refresh LV — restart live view dCC pas frame ngefreeze. Canon only. */}
                {isCanon && (
                  <button
                    onClick={resetLiveView}
                    disabled={countdown !== null || lvResetting}
                    aria-label="Refresh live view"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 44, height: 44, borderRadius: 12,
                      background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.3)',
                      color: '#fff', cursor: 'pointer', backdropFilter: 'blur(8px)',
                      opacity: countdown !== null || lvResetting ? 0.4 : 1,
                    }}
                  >
                    {/* Huruf "R" — dulu ikon panah melengkung, ketuker sama tombol rotate di
                        atasnya (dua-duanya panah). Muter pas lagi reset = feedback proses jalan. */}
                    <span style={{
                      fontFamily: 'var(--font-ui)', fontSize: 18, fontWeight: 700, lineHeight: 1,
                      display: 'inline-block',
                      animation: lvResetting ? 'spin 0.8s linear infinite' : undefined,
                    }}>R</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {captured && cameraReady && (
            <div className="absolute inset-0 flex items-end justify-end p-4" style={{ zIndex: 30 }}>
              <button
                onClick={() => { setCaptured(null); handleCapture() }}
                disabled={countdown !== null}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 44, height: 44, borderRadius: 12,
                  background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.3)',
                  color: '#fff', cursor: 'pointer', backdropFilter: 'blur(8px)',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </button>
            </div>
          )}

        </div>
        </div>
      </div>

      <div className="screen-actions shrink-0 p-5 flex gap-3">
        <label className="glass-btn h-[72px] flex-1 cursor-pointer" style={{ background: 'rgba(255,255,255,0.08)', color: '#ffffff', boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.15), inset -1px -1px 0 rgba(0,0,0,0.15)' }}>
          <input type="file" accept="image/*" className="sr-only" onChange={handleBrowse} />
          {t('liveview_browse') as string}
        </label>
        {captured ? (
          <TouchButton onClick={() => dispatch({ type: 'CAPTURE', imageUrl: captured })} className="flex-1">
            Next →
          </TouchButton>
        ) : (
          <TouchButton onClick={handleCapture} disabled={countdown !== null || !cameraReady} className="flex-1">
            {t('liveview_capture') as string}
          </TouchButton>
        )}
      </div>

    </div>
  )
}
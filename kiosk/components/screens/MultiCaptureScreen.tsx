'use client'
import { useEffect, useRef, useState, useCallback, type Dispatch, type CSSProperties } from 'react'
import { TouchButton } from '@/components/ui/TouchButton'
import { PrintLayoutPreview } from '@/components/ui/PrintLayoutPreview'
import { stopCamera, triggerCanonCapture, rotateDataUrl } from '@/lib/camera'
import { rotatedSize, CANON_LIVE, CANON_LIVE_MS } from '@/components/screens/LiveViewScreen'
import { layoutSlots } from '@/lib/print-layout'
import type { KioskAction, KioskState } from '@/lib/types'
import { useT } from '@/lib/i18n'

type Props = {
  state: Extract<KioskState, { screen: 'multicapture' }>
  dispatch: Dispatch<KioskAction>
  cameraSource?: string
}

// Kalibrasi rotasi SHARE sama LiveViewScreen — mode print gak pernah lewat liveview,
// jadi tombol rotate ada di sini juga dan nyimpen ke key yang sama.
const ROT_KEY = 'semeta.cameraRotation'
const SHOT_GAP_MS = 900 // jeda "bersiap" antar shot

// ponytail: capture core (getUserMedia + rotasi + countdown) duplikat dari LiveViewScreen —
// itu screen battle-tested 2 event live, jangan disentuh. Extract hook kalau ada screen ketiga.
export function MultiCaptureScreen({ state, dispatch, cameraSource }: Props) {
  const t = useT()
  const isCanon = cameraSource === 'canon'
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [flash, setFlash] = useState(false)
  const [running, setRunning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [containerDims, setContainerDims] = useState<{ w: number; h: number } | null>(null)

  const target = state.template.shot_count ?? 4
  const done = state.shots.length >= target

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(ROT_KEY))
      if ([0, 90, 180, 270].includes(saved)) setRotation(saved)
    } catch {}
  }, [])

  const rotate = useCallback(() => {
    setRotation(r => {
      const next = (r + 90) % 360
      try { localStorage.setItem(ROT_KEY, String(next)) } catch {}
      return next
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      if (entries[0]) setContainerDims({ w: entries[0].contentRect.width, h: entries[0].contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    // Canon: capture lewat backend (DSLR bukan webcam). Enable; preview = MJPEG best-effort.
    if (isCanon) {
      setCameraReady(true)
      // Restart LV paksa tiap mount — sama kayak LiveViewScreen: sesi baru = LV seger,
      // ga ngandelin frame basi dCC (HTTP 200 tapi beku) dari sesi sebelumnya.
      fetch('/api/canon-live', { method: 'POST' }).catch(() => { /* freeze-detect jaring kedua */ })
      return
    }
    const el = videoRef.current
    if (!el) return
    let cancelled = false
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(tr => tr.stop()); return }
        el.srcObject = stream
        el.play()
          .then(() => setCameraReady(true))
          .catch(err => { if (err?.name !== 'AbortError') setCameraError(true) })
      })
      .catch(() => { if (!cancelled) setCameraError(true) })
    return () => { cancelled = true; stopCamera(el) }
  }, [retry, isCanon])

  const retryCamera = useCallback(() => {
    setCameraError(false)
    setCameraReady(false)
    setRetry(n => n + 1)
  }, [])

  // Browse: pilih file dari disk → isi 1 slot (dispatch SHOT_TAKEN, sama kayak 1 shot kamera).
  // Reducer clamp di target → ga bisa overfill. Cuma aktif pre-start (biar ga balapan auto-sequence).
  const handleBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const url = ev.target?.result as string
      if (url) dispatch({ type: 'SHOT_TAKEN', imageUrl: url })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // Canon live-ish: bump tiap CANON_LIVE_MS → <img> cache-bust → re-fetch frame proxy. Berhenti
  // pas done (semua shot udah diambil). Webcam ga kena (pakai <video> stream).
  // capturing: polling setop selama shutter — capture route nge-Hide LV, polling yang jalan
  // terus bakal nge-Show LV lagi di tengah shutter (race → kamera hang). Sama kayak LiveView.
  const [capturing, setCapturing] = useState(false)
  const [liveTick, setLiveTick] = useState(0)
  useEffect(() => {
    if (!isCanon || done || capturing) return
    const id = setInterval(() => setLiveTick(t => t + 1), CANON_LIVE_MS)
    return () => clearInterval(id)
  }, [isCanon, done, capturing])

  // Satu jepretan: countdown 3-2-1 → flash → canvas (rotasi ikut kalibrasi) → dataURL
  const captureShot = useCallback(async (): Promise<string | null> => {
    for (const n of [3, 2, 1]) {
      setCountdown(n)
      await new Promise(r => setTimeout(r, 800))
    }
    setCountdown(null)
    setFlash(true)
    await new Promise(r => setTimeout(r, 200))
    setFlash(false)
    if (isCanon) {
      // Rotate ikut tombol — non-faceswap (print) = orientasi kamera nentuin hasil, DSLR ga bisa
      // diputer fisik. deg 0 = passthrough.
      setCapturing(true)
      try { return await rotateDataUrl(await triggerCanonCapture(), rotation) }
      catch { setCameraError(true); return null }
      finally { setCapturing(false) }
    }
    const video = videoRef.current
    if (!video) return null
    const vw = video.videoWidth
    const vh = video.videoHeight
    const { w, h } = rotatedSize(vw, vh, rotation)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.translate(w / 2, h / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.drawImage(video, -vw / 2, -vh / 2)
    return canvas.toDataURL('image/jpeg', 0.92)
  }, [rotation, isCanon])

  // dispatch (wrappedDispatch KioskApp) identity-nya bisa ganti tiap render — countdown billing
  // re-render KioskApp 1 Hz di sesi berbayar. Kalau dispatch masuk dep array, effect sequence
  // ke-cancel tiap detik dan SHOT_TAKEN gak pernah kejadian (satu shot butuh ±3.5s). Ref = imun.
  const dispatchRef = useRef(dispatch)
  useEffect(() => { dispatchRef.current = dispatch })

  // Sequence otomatis: tiap shots nambah (atau RETAKE_SHOTS ngosongin), effect jalanin
  // shot berikutnya sampai target. Retake pas review → shots [] → sequence restart sendiri.
  useEffect(() => {
    if (!running || done || !cameraReady) return
    let cancelled = false
    ;(async () => {
      await new Promise(r => setTimeout(r, SHOT_GAP_MS))
      if (cancelled) return
      const url = await captureShot()
      if (!cancelled && url) dispatchRef.current({ type: 'SHOT_TAKEN', imageUrl: url })
    })()
    return () => { cancelled = true }
  }, [running, done, cameraReady, state.shots.length, captureShot])

  const quarter = rotation === 90 || rotation === 270
  const printSize = state.template.print_size || '4R_PORTRAIT'
  const isLandscapePrint = printSize === '4R_LANDSCAPE'
  const isPrint = state.template.engine_type === 'print'

  // Match the camera capture box to the EXACT aspect ratio of the individual cells in the template.
  const { slots } = layoutSlots(printSize, target, state.template.layout_config)
  const cellIsLandscape = slots[0] ? slots[0].w >= slots[0].h : true

  // During review (done), the box MUST match the full paper's aspect ratio.
  // During capture (!done) for print, match the individual cell's aspect ratio.
  const boxClass = done
    ? (isLandscapePrint
        ? 'aspect-[3/2] w-full max-w-full h-auto max-h-full'
        : 'aspect-[2/3] w-[500px] max-w-full max-h-full h-auto')
    : isPrint
      ? (cellIsLandscape
          ? 'aspect-[3/2] w-full max-w-full h-auto max-h-full'
          : 'aspect-[2/3] w-[500px] max-w-full max-h-full h-auto')
      : quarter
        ? 'aspect-[9/16] w-[500px] max-w-full max-h-full h-auto'
        : 'aspect-video w-full max-w-full h-auto max-h-full'

  // Style live-feed dipakai bareng <video> (webcam) & <img> MJPEG (canon).
  const liveStyle: CSSProperties = {
    display: done ? 'none' : 'block',
    width: quarter ? (containerDims ? `${containerDims.h}px` : '100vh') : '100%',
    height: quarter ? (containerDims ? `${containerDims.w}px` : '100vw') : '100%',
    objectFit: 'cover',
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  }

  return (
    <div className="screen-split flex flex-col w-full h-full overflow-hidden">

      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1 className="h1-glow" style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>
          {done ? (t('multicapture_review_title') as string) : (t('multicapture_title') as string)}
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618, whiteSpace: 'pre-line' }}>
          {running || done
            ? `${t('multicapture_counter') as string} ${Math.min(state.shots.length + (done ? 0 : 1), target)}/${target}`
            : (t('multicapture_subtitle') as string)}
        </p>
      </div>

      <div className="screen-content">
        <div className="flex-1 min-h-0 flex items-center justify-center p-5">
          <div
            ref={containerRef}
            className={`relative overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10 ${boxClass}`}
            style={{ background: '#000' }}
          >
            {isCanon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${CANON_LIVE}?t=${liveTick}`} alt="" className="absolute top-1/2 left-1/2 max-w-none max-h-none" style={liveStyle} />
            ) : (
              <video
                ref={videoRef}
                autoPlay playsInline muted
                className="absolute top-1/2 left-1/2 max-w-none max-h-none"
                style={liveStyle}
              />
            )}

            {/* Review: Preview hasil asli print secara langsung! (CSS representation) */}
            {done && (
              <div className="absolute inset-0 p-3" style={{ background: '#111' }}>
                <PrintLayoutPreview template={state.template} shots={state.shots} />
              </div>
            )}

            {!cameraReady && !cameraError && !done && (
              <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: '#000' }}>
                <div style={{ width: 36, height: 36, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'var(--fg)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <p style={{ fontSize: 'var(--text-xs)', letterSpacing: '0.2em', color: 'var(--fg-muted)', marginTop: 16, textTransform: 'uppercase' }}>{t('liveview_loading_camera') as string}</p>
              </div>
            )}

            {cameraError && !done && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: '#000' }}>
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

            {/* Jeda antar shot: "bersiap" biar tamu ganti pose */}
            {running && !done && countdown === null && !flash && state.shots.length > 0 && (
              <div className="absolute inset-x-0 top-4 flex justify-center" style={{ zIndex: 15 }}>
                <span style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', padding: '8px 20px', borderRadius: 999, fontSize: 'var(--text-sm)', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#fff' }}>
                  {t('multicapture_get_ready') as string}
                </span>
              </div>
            )}

            {flash && <div className="absolute inset-0 bg-white z-20" />}

            {/* Rotate — kalibrasi pre-start only (mode print gak pernah lewat liveview) */}
            {cameraReady && !running && !done && (
              <div className="absolute inset-0 flex items-start justify-end p-4" style={{ zIndex: 30 }}>
                <button
                  onClick={rotate}
                  aria-label={t('liveview_rotate_aria') as string}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 44, height: 44, borderRadius: 12,
                    background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.3)',
                    color: '#fff', cursor: 'pointer', backdropFilter: 'blur(8px)',
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              </div>
            )}

            {/* Progress dots selama sequence */}
            {running && !done && (
              <div className="absolute inset-x-0 bottom-4 flex justify-center gap-2" style={{ zIndex: 15 }}>
                {Array.from({ length: target }, (_, i) => (
                  <span key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: i < state.shots.length ? '#fff' : 'rgba(255,255,255,0.25)' }} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Thumbnails of taken shots (Requested for Photo Print) */}
        {isPrint && !done && state.shots.length >= 0 && (
          <div className="shrink-0 flex justify-center gap-2 px-5 pb-5 mt-[-10px]">
            {Array.from({ length: target }, (_, i) => {
              const url = state.shots[i]
              return (
                <div key={i} style={{
                  width: cellIsLandscape ? 60 : 45,
                  height: cellIsLandscape ? 40 : 60,
                  borderRadius: 6,
                  border: url ? '1.5px solid #a78bfa' : '1.5px dashed rgba(255,255,255,0.2)',
                  background: url ? `url(${url}) center/cover no-repeat` : 'rgba(0,0,0,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  {!url && <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.2)', fontWeight: 600 }}>{i + 1}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="screen-actions shrink-0 p-5 flex gap-3">
        {!running && !done && (
          <>
            <TouchButton variant="secondary" onClick={() => dispatch({ type: 'BACK' })} className="flex-1">
              {t('nav_back') as string}
            </TouchButton>
            <label className="glass-btn h-[72px] flex-1 cursor-pointer" style={{ background: 'rgba(255,255,255,0.08)', color: '#ffffff', boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.15), inset -1px -1px 0 rgba(0,0,0,0.15)' }}>
              <input type="file" accept="image/*" className="sr-only" onChange={handleBrowse} />
              {t('liveview_browse') as string}
            </label>
            <TouchButton onClick={() => setRunning(true)} disabled={!cameraReady} className="flex-1">
              {t('multicapture_start') as string}
            </TouchButton>
          </>
        )}
        {done && (
          <>
            <TouchButton variant="secondary" onClick={() => dispatch({ type: 'RETAKE_SHOTS' })} className="flex-1">
              {t('multicapture_retake') as string}
            </TouchButton>
            <TouchButton onClick={() => dispatch({ type: 'START_PROCESSING' })} className="flex-1">
              {t('nav_next') as string}
            </TouchButton>
          </>
        )}
      </div>

    </div>
  )
}

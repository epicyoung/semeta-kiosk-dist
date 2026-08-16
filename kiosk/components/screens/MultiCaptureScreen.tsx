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

const ROT_KEY = 'semeta.cameraRotation'

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
  const [rotation, setRotation] = useState(0)
  const [containerDims, setContainerDims] = useState<{ w: number; h: number } | null>(null)
  const [pendingShot, setPendingShot] = useState<string | null>(null)

  const target = state.template.shot_count ?? 4
  const confirmedCount = state.shots.length
  const done = confirmedCount >= target && pendingShot === null
  const isReviewingPending = pendingShot !== null

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
    if (isCanon) {
      setCameraReady(true)
      fetch('/api/canon-live', { method: 'POST' }).catch(() => {})
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

  const handleBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const url = ev.target?.result as string
      if (url) setPendingShot(url)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const [capturing, setCapturing] = useState(false)
  const [liveTick, setLiveTick] = useState(0)
  useEffect(() => {
    if (!isCanon || done || capturing || isReviewingPending) return
    const id = setInterval(() => setLiveTick(t => t + 1), CANON_LIVE_MS)
    return () => clearInterval(id)
  }, [isCanon, done, capturing, isReviewingPending])

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

  const handleTriggerCapture = useCallback(async () => {
    if (capturing || countdown !== null || !cameraReady || done || isReviewingPending) return
    const url = await captureShot()
    if (url) {
      setPendingShot(url)
    }
  }, [capturing, countdown, cameraReady, done, isReviewingPending, captureShot])

  const handleAcceptPending = () => {
    if (!pendingShot) return
    dispatch({ type: 'SHOT_TAKEN', imageUrl: pendingShot })
    setPendingShot(null)
  }

  const handleRetakePending = () => {
    setPendingShot(null)
  }

  const handleRetakeAll = () => {
    setPendingShot(null)
    dispatch({ type: 'RETAKE_SHOTS' })
  }

  const handlePopPrevious = () => {
    if (pendingShot) {
      setPendingShot(null)
      return
    }
    if (confirmedCount > 0) {
      dispatch({ type: 'POP_LAST_SHOT' })
    } else {
      dispatch({ type: 'BACK' })
    }
  }

  const quarter = rotation === 90 || rotation === 270
  const printSize = state.template.print_size || '4R_PORTRAIT'
  const isLandscapePrint = printSize === '4R_LANDSCAPE'
  const isPrint = state.template.engine_type === 'print'

  const { slots } = layoutSlots(printSize, target, state.template.layout_config)
  const cellIsLandscape = slots[0] ? slots[0].w >= slots[0].h : true

  // During review (done), match full paper aspect ratio.
  // During single shot capture or preview (!done), match individual cell aspect ratio.
  const boxClass = done
    ? (isLandscapePrint
        ? 'aspect-[3/2] w-full max-w-full h-auto max-h-full'
        : 'aspect-[2/3] w-[500px] max-w-full max-h-full h-auto')
    : (cellIsLandscape
        ? 'aspect-[3/2] w-full max-w-full h-auto max-h-full'
        : 'aspect-[2/3] w-[500px] max-w-full max-h-full h-auto')

  const liveStyle: CSSProperties = {
    display: (done || isReviewingPending) ? 'none' : 'block',
    width: quarter ? (containerDims ? `${containerDims.h}px` : '100vh') : '100%',
    height: quarter ? (containerDims ? `${containerDims.w}px` : '100vw') : '100%',
    objectFit: 'cover',
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  }

  return (
    <div className="screen-split flex flex-col w-full h-full overflow-hidden">

      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1 className="h1-glow" style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>
          {done
            ? (t('multicapture_review_title') as string)
            : isReviewingPending
            ? (t('multicapture_review_title') as string)
            : (t('multicapture_title') as string)}
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618, whiteSpace: 'pre-line' }}>
          {done
            ? `${t('multicapture_counter') as string} ${target}/${target}`
            : `${t('multicapture_counter') as string} ${confirmedCount + 1}/${target}`}
        </p>
      </div>

      <div className="screen-content">
        <div className="flex-1 min-h-0 flex items-center justify-center p-5">
          <div
            ref={containerRef}
            className={`relative overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10 ${boxClass}`}
            style={{ background: '#000' }}
          >
            {!done && !isReviewingPending && (
              isCanon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${CANON_LIVE}?t=${liveTick}`} alt="" className="absolute top-1/2 left-1/2 max-w-none max-h-none" style={liveStyle} />
              ) : (
                <video
                  ref={videoRef}
                  autoPlay playsInline muted
                  className="absolute top-1/2 left-1/2 max-w-none max-h-none"
                  style={liveStyle}
                />
              )
            )}

            {!done && isReviewingPending && pendingShot && (
              <div className="absolute inset-0 flex items-center justify-center bg-black overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pendingShot}
                  alt={`Preview Shot ${confirmedCount + 1}`}
                  className="w-full h-full object-cover animate-fade-in"
                />
              </div>
            )}

            {done && (
              <div className="absolute inset-0 p-3" style={{ background: '#111' }}>
                <PrintLayoutPreview template={state.template} shots={state.shots} />
              </div>
            )}

            {!cameraReady && !cameraError && !done && !isReviewingPending && (
              <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: '#000' }}>
                <div style={{ width: 36, height: 36, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'var(--fg)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <p style={{ fontSize: 'var(--text-xs)', letterSpacing: '0.2em', color: 'var(--fg-muted)', marginTop: 16, textTransform: 'uppercase' }}>{t('liveview_loading_camera') as string}</p>
              </div>
            )}

            {cameraError && !done && !isReviewingPending && (
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

            {flash && <div className="absolute inset-0 bg-white z-20" />}

            {cameraReady && !done && !isReviewingPending && countdown === null && (
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
          </div>
        </div>

        {isPrint && (
          <div className="shrink-0 flex justify-center gap-2 px-5 pb-5 mt-[-10px]">
            {Array.from({ length: target }, (_, i) => {
              const isConfirmed = i < confirmedCount
              const isPending = i === confirmedCount && isReviewingPending
              const url = isConfirmed ? state.shots[i] : isPending ? pendingShot : null
              const isCurrent = i === confirmedCount

              return (
                <div
                  key={i}
                  onClick={() => {
                    if (isConfirmed) {
                      if (pendingShot) setPendingShot(null)
                      dispatch({ type: 'SET_STATE', state: { ...state, shots: state.shots.slice(0, i) } })
                    }
                  }}
                  style={{
                    width: cellIsLandscape ? 60 : 45,
                    height: cellIsLandscape ? 40 : 60,
                    borderRadius: 6,
                    border: isCurrent
                      ? '2px solid #a78bfa'
                      : url
                      ? '1.5px solid rgba(167,139,250,0.6)'
                      : '1.5px dashed rgba(255,255,255,0.2)',
                    background: url ? `url(${url}) center/cover no-repeat` : 'rgba(0,0,0,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: isConfirmed ? 'pointer' : 'default',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {!url && <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.2)', fontWeight: 600 }}>{i + 1}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="screen-actions shrink-0 p-5 flex gap-3">
        {!done && !isReviewingPending && (
          <>
            <TouchButton variant="secondary" onClick={handlePopPrevious} className="flex-1">
              {confirmedCount > 0 ? `← Foto ${confirmedCount}` : (t('nav_back') as string)}
            </TouchButton>
            <label className="glass-btn h-[72px] flex-1 cursor-pointer" style={{ background: 'rgba(255,255,255,0.08)', color: '#ffffff', boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.15), inset -1px -1px 0 rgba(0,0,0,0.15)' }}>
              <input type="file" accept="image/*" className="sr-only" onChange={handleBrowse} />
              {t('liveview_browse') as string}
            </label>
            <TouchButton onClick={handleTriggerCapture} disabled={!cameraReady || capturing || countdown !== null} className="flex-1">
              {t('liveview_capture') as string}
            </TouchButton>
          </>
        )}

        {!done && isReviewingPending && (
          <>
            <TouchButton variant="secondary" onClick={handleRetakePending} className="flex-1">
              {t('multicapture_retake') as string}
            </TouchButton>
            <TouchButton onClick={handleAcceptPending} className="flex-1">
              {t('nav_next') as string}
            </TouchButton>
          </>
        )}

        {done && (
          <>
            <TouchButton variant="secondary" onClick={handleRetakeAll} className="flex-1">
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

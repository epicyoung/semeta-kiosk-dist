'use client'
import { useEffect, useRef, useState, type Dispatch } from 'react'
import { TouchButton } from '@/components/ui/TouchButton'
import { comfyGenerate, type ComfyCfg } from '@/lib/comfy'
import { proxied } from '@/lib/facedetect'
import type { GenerationSource, KioskAction, KioskState, SwapResult, VideoProvider } from '@/lib/types'
import { animateImage } from '@/lib/video'
import { uploadAsset } from '@/lib/upload'
import { burnWatermark } from '@/lib/watermark-canvas'
import { composePrintLayout } from '@/lib/print-layout'
import { useMagicCatcher } from '@/lib/use-magic-catcher'
import { useT } from '@/lib/i18n'

// Write one full-res photo to disk (server route owns fs + naming convention)
// Local print files are always full-res. Web-sized copies only exist in R2 (Original + AI,
// both resized on upload, keyed _A/_B — a separate naming contract with the microsite).
async function saveLocal(eventName: string, seq: string, kind: 'original' | 'ai', imageUrl: string) {
  await fetch('/api/save-local', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_name: eventName, seq, kind, image_base64: imageUrl }),
  })
}

// Finalize LOKAL saja: real persistent seq → save A+AI full-res ke disk (print/arsip).
// Upload R2 + QR pindah ke DeliveryScreen (frame di-burn dulu di titik commit — spec 2026-07-04).
// Return base (eventFolder-paddedSeq) buat konsistensi nama file lokal ↔ key R2.
// Gagal = null + onFail (log UPLOAD_FAILED stage finalize) — preview jalan terus,
// Delivery fallback next-seq sendiri.
async function finalizeLocal(
  eventName: string,
  localOriginalUrl: string, localAiUrl: string,
  onFail?: (err: unknown) => void,
): Promise<string | null> {
  try {
    const res = await fetch('/api/next-seq', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_name: eventName }),
    })
    const { paddedSeq, eventFolder } = await res.json()
    await Promise.all([
      saveLocal(eventName, paddedSeq, 'original', localOriginalUrl),
      saveLocal(eventName, paddedSeq, 'ai', localAiUrl),
    ])
    return `${eventFolder}-${paddedSeq}`
  } catch (err) {
    console.error('finalize local failed:', err)
    try { onFail?.(err) } catch { /* analytics ga boleh matiin kiosk */ }
    return null
  }
}

// Burn both images ONCE when unlicensed → single source for preview + print + save.
// Licensed → pass through untouched. Returns {original, ai} dataURLs.
async function localCopies(originalUrl: string, aiUrl: string, licensed: boolean) {
  if (licensed) return { original: originalUrl, ai: aiUrl }
  const [original, ai] = await Promise.all([burnWatermark(originalUrl), burnWatermark(aiUrl)])
  return { original, ai }
}

// dataUrl or regular URL → Blob
async function toBlob(url: string): Promise<Blob> {
  if (url.startsWith('data:')) {
    const [header, b64] = url.split(',')
    const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg'
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return new Blob([arr], { type: mime })
  }
  const res = await fetch(proxied(url)) // cross-origin (R2 template) → proxy same-origin, bypass CORS
  return res.blob()
}

async function localSwap(
  templateUrl: string,
  selfieUrl: string,
  onProgress: (pct: number) => void,
  faceMapping?: (number | null)[],
): Promise<string> {
  onProgress(10)
  const [templateBlob, selfieBlob] = await Promise.all([toBlob(templateUrl), toBlob(selfieUrl)])
  onProgress(30)
  const fd = new FormData()
  fd.append('template', templateBlob, 'template.jpg')
  fd.append('selfie', selfieBlob, 'selfie.jpg')
  // Assignment dari FaceAssign — face_server swap tiap muka sesuai ini. Absen → server default swap semua L-R.
  if (faceMapping && faceMapping.length > 0) fd.append('mapping', JSON.stringify(faceMapping))
  onProgress(50)
  const res = await fetch('http://localhost:8000/swap', { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`face_server /swap: ${res.status}`)
  onProgress(85)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

// ponytail: dev mock — set false kalau backend nyata siap
const MOCK = false
const MOCK_MS = 10_000
const MOCK_AI_URL = '/photo-1488426862026-3ee34a7d66df.jpg'

const STEPS = ['Detect', 'Process', 'Finishing']

// ── Denoise reveal (SD sampler-step aesthetic) ───────────────────────────────
// Simulates the chosen template being "AI generated": blocky+noisy latent →
// crisp, stepping like a Stable Diffusion sampler. Runs on its OWN estimate clock
// — NOT raw pct, which arrives chunked (cloud 10/90/100, local 10/30/50/85/100),
// so a pct-driven blur would jump twice. pct is consulted only as a ready gate:
// the ladder HOLDS at the penultimate rung until the result actually lands, then
// snaps crisp. ProcessingScreen dwells REVEAL_DWELL_MS after pct=100 so this crisp
// frame is seen before SHOW_PREVIEW unmounts the screen.
const DENOISE_STEPS = [10, 18, 34, 64, 128] as const // canvas block-res per rung; low = blocky latent
const LAST_STEP = DENOISE_STEPS.length - 1
const HOLD_STEP = LAST_STEP - 1                        // parks here until result ready
const STEP_MS = 850                                   // ms per rung (self-running cadence)
const READY_PCT = 100                                 // real progress meaning "result is here"
const MAX_BLUR_PX = 16                                 // base-image blur at the blockiest rung
const MAX_GRAIN = 0.5                                  // latent-noise overlay opacity at rung 0

// Pure step advance: climb one rung, park at penultimate until ready, snap to last
// when ready, never regress/overshoot. Self-check: nextDenoiseStep.test.mjs
function nextDenoiseStep(s: number, ready: boolean): number {
  if (s >= LAST_STEP) return s
  return Math.min(s + 1, ready ? LAST_STEP : HOLD_STEP)
}

// cover-fit draw into a tiny canvas → CSS upscales it blocky (image-rendering:pixelated).
function paintCanvas(cv: HTMLCanvasElement | null, im: HTMLImageElement | null, step: number) {
  if (!cv || !im) return
  const w = DENOISE_STEPS[step], h = Math.round(w * 1.5) // 2:3 card
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d'); if (!ctx) return
  ctx.imageSmoothingEnabled = false
  const ir = im.width / im.height, cr = w / h
  const [sw, sh] = ir > cr ? [im.height * cr, im.height] : [im.width, im.width / cr]
  ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, 0, 0, w, h)
}

function RenderCosmetics({ src, pct }: { src: string; pct: number }) {
  const [reduce] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)

  const [step, setStep] = useState(reduce ? LAST_STEP : 0)
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null)
  const pctRef = useRef(pct)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => { pctRef.current = pct }, [pct]) // live pct for the interval, no stale closure

  // Self-running ladder. Parks at HOLD_STEP until pct>=READY_PCT; self-clears at crisp.
  useEffect(() => {
    if (reduce) return
    const id = setInterval(() => {
      setStep(s => {
        const n = nextDenoiseStep(s, pctRef.current >= READY_PCT)
        if (n >= LAST_STEP) clearInterval(id)
        return n
      })
    }, STEP_MS)
    return () => clearInterval(id)
  }, [reduce])

  // Result already here → snap straight to crisp instead of crawling remaining rungs.
  useEffect(() => { if (pct >= READY_PCT) setStep(LAST_STEP) }, [pct])

  // Load source once; tainted cross-origin canvas still displays (we never read it back).
  useEffect(() => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => setImgEl(im)
    im.src = proxied(src) // cross-origin (R2 template) → proxy same-origin biar canvas ga tainted
    return () => setImgEl(null)
  }, [src])

  // Repaint the blocky layer whenever the image loads or the rung changes.
  useEffect(() => { paintCanvas(canvasRef.current, imgEl, step) }, [imgEl, step])

  const isCrisp = step >= LAST_STEP
  const t = step / LAST_STEP                          // 0..1 clarity
  const blurPx = isCrisp ? 0 : Math.round((1 - t) * MAX_BLUR_PX)
  const grain = isCrisp ? 0 : (1 - t) * MAX_GRAIN

  return (
    <div className="denoise-card relative aspect-[2/3] w-44 rounded-xl overflow-hidden flex-shrink-0 bg-[#090135]">
      <svg width="0" height="0" className="absolute pointer-events-none" aria-hidden>
        <filter id="denoise-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" seed="7" />
          <feColorMatrix type="matrix" values="1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 0.5 0" />
        </filter>
      </svg>

      {/* crisp target underneath — blur + latent saturation/contrast ease out per rung */}
      <img src={src} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover"
        style={{
          filter: `blur(${blurPx}px) saturate(${70 + t * 40}%) contrast(${115 - t * 15}%)`,
          transition: 'filter 800ms cubic-bezier(0.16,1,0.3,1)',
        }} />

      {/* blocky pixelation on top, fades out as it resolves */}
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 w-full h-full"
        style={{ imageRendering: 'pixelated', objectFit: 'cover', opacity: isCrisp ? 0 : 1, transition: 'opacity 600ms ease' }} />

      {/* SD-style latent grain, thins each rung */}
      <div className="absolute inset-0 pointer-events-none mix-blend-overlay"
        style={{ filter: 'url(#denoise-grain)', opacity: grain, transition: 'opacity 600ms ease' }} />

      {/* single cyan scan pass, re-keyed per rung (GPU transform only) */}
      {!isCrisp && !reduce && (
        <div key={step} className="denoise-sweep absolute inset-x-0 h-1/3 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, transparent, rgba(0,245,212,0.18), transparent)' }} />
      )}

      {/* sampler step readout — sells the "step N/N" fidelity */}
      <div className="absolute bottom-1.5 right-2 pointer-events-none font-mono tabular-nums"
        style={{
          fontSize: '10px', letterSpacing: '0.08em',
          color: isCrisp ? 'rgba(0,245,212,0.9)' : 'rgba(255,255,255,0.55)',
          textShadow: '0 1px 4px rgba(9,1,53,0.9)', transition: 'color 400ms ease',
        }}>
        {isCrisp ? 'done' : `step ${step + 1}/${LAST_STEP + 1}`}
      </div>

      {/* brand ring → lights cyan on completion */}
      <div className="absolute inset-0 rounded-xl pointer-events-none"
        style={{
          boxShadow: isCrisp
            ? 'inset 0 0 0 1px rgba(0,245,212,0.55), 0 0 24px -6px rgba(0,245,212,0.5)'
            : 'inset 0 0 0 1px rgba(124,58,237,0.35)',
          transition: 'box-shadow 700ms ease',
        }} />
    </div>
  )
}

// Dwell after pct=100 so the crisp denoise frame paints before SHOW_PREVIEW unmounts us.
const REVEAL_DWELL_MS = 900

type Props = {
  state: Extract<KioskState, { screen: 'processing' }>
  dispatch: Dispatch<KioskAction>
  generationSource: GenerationSource
  eventName: string
  licensed: boolean
  bypassed: boolean
  comfy: ComfyCfg
  enableMagicCatcher: boolean
  enableVideoEngine: boolean
  videoProvider: VideoProvider
  onUploadFailed?: (metadata: Record<string, unknown>) => void
}

export function ProcessingScreen({ state, dispatch, generationSource, eventName, licensed, bypassed, comfy, enableMagicCatcher, enableVideoEngine, videoProvider, onUploadFailed }: Props) {
  const t = useT()
  const copy = t('processing_copy') as string[]
  const [copyIndex, setCopyIndex] = useState(0)
  // Video engine ON → tampilkan status "animating" biar tamu tau mesin ga hang (render video lama).
  const [animating, setAnimating] = useState(false)
  // Multi-template: index template yang lagi di-swap (buat teks "N/M…"). Single = 0, ga tampil.
  const [multiIdx, setMultiIdx] = useState(0)
  // ponytail: #error hash → preview error-state. Reaktif ke hashchange biar ganti hash di bar ga nyangkut.
  const isErrorHash = () => typeof window !== 'undefined' && window.location.hash === '#error'
  const [timedOut, setTimedOut] = useState(isErrorHash)

  // Magic Catcher — rekam reaksi tamu saat reveal AI. Gated: toggle config + disclaimer di idle.
  // No-op internal kalau disabled / #error preview. Hook self-cleaning (kamera mati pas unmount).
  useMagicCatcher({ enabled: enableMagicCatcher && !timedOut, eventName })

  useEffect(() => {
    const onHash = () => setTimedOut(isErrorHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (timedOut) return // #error preview — jangan generate
    const interval = setInterval(() => setCopyIndex(i => (i + 1) % copy.length), 4_000)
    const genStart = performance.now() // processing duration for the log (performance.now = clock-safe)

    // Video engine post-step, dipakai semua jalur single sebelum SHOW_PREVIEW.
    // FAIL-SAFE: gagal apa pun return undefined → preview lanjut dgn foto still.
    // Tamu ga boleh pulang kosong cuma karena provider video down.
    //
    // Ceiling #2 fix: FAL butuh image_url PUBLIK. Hasil AI = dataURL/blob/localhost yg FAL
    // ga bisa akses → upload dulu sbg seed (type S, bersih, no watermark) ke R2, kirim URL
    // R2 publik ke FAL. base = session id (buat key R2). Gagal upload = skip video (foto aman).
    const maybeAnimate = async (aiUrl: string, base?: string): Promise<string | undefined> => {
      // ponytail: video buat godmode dulu (bypassed). Kiosk berbayar biasa ga nyoba → hemat FAL,
      // ga kena 402. Buka ke token-user nanti = hapus `|| !bypassed` (worker udah gate token).
      if (!enableVideoEngine || !bypassed) return undefined
      setAnimating(true)
      try {
        let seedUrl = aiUrl
        if (base) {
          try {
            const { url } = await uploadAsset(aiUrl, 'S', base, { eventName })
            seedUrl = url // URL R2 publik — FAL bisa akses
          } catch (e) {
            console.error('[video] seed upload gagal, kirim url asli (mungkin ditolak FAL):', e)
          }
        }
        const video = await animateImage(seedUrl, videoProvider)
        return video ?? undefined
      } finally {
        setAnimating(false)
      }
    }

    if (MOCK) {
      const t0 = performance.now()
      const tick = setInterval(() => {
        const pct = Math.min(100, Math.round(((performance.now() - t0) / MOCK_MS) * 100))
        dispatch({ type: 'SET_PROGRESS', progress: pct })
      }, 200)
      const done = setTimeout(async () => {
        const local = await localCopies(MOCK_AI_URL, state.imageUrl || MOCK_AI_URL, licensed)
        await new Promise(r => setTimeout(r, REVEAL_DWELL_MS)) // let the crisp reveal paint first
        dispatch({ type: 'SHOW_PREVIEW', aiUrl: local.ai, originalUrl: local.original, sourceUrl: state.imageUrl || MOCK_AI_URL })
        // MOCK: skip upload — no real image data available
      }, MOCK_MS)
      return () => { clearInterval(tick); clearTimeout(done); clearInterval(interval) }
    }

    // Photo Print: compose lokal (BUKAN AI, nol token, full offline) — N shot + overlay → satu sheet.
    // Skip maybeAnimate (gak ada gambar AI buat di-animate) & direct skip framechooser
    // (overlay udah kebakar di composite — frame kedua bakal numpuk di print+upload).
    const printShots = state.templates[0].engine_type === 'print' ? state.shots : undefined
    if (printShots && printShots.length > 0) {
      const tmpl = state.templates[0]
      const controller = new AbortController()
      // Watchdog 120s kayak sibling engine — overlay dari PB bisa ngadat, jangan parkir di 30%.
      const timeout = setTimeout(() => { controller.abort(); setTimedOut(true) }, 120_000)
      ;(async () => {
        dispatch({ type: 'SET_PROGRESS', progress: 30 })
        const sheet = await composePrintLayout(printShots, tmpl.overlay_url ?? null, tmpl.print_size ?? '4R')
        if (controller.signal.aborted) return
        dispatch({ type: 'SET_PROGRESS', progress: 70 })
        // Watermark freemium tetep berlaku: display di-burn saat unlicensed, raw bersih
        // buat upload (Worker yang burn server-side). original = shot pertama (polos).
        const local = await localCopies(printShots[0], sheet, licensed)
        dispatch({ type: 'SET_PROGRESS', progress: 100 })
        const [base] = await Promise.all([
          finalizeLocal(eventName, local.original, local.ai,
            (err) => onUploadFailed?.({ stage: 'finalize', error: String(err).slice(0, 300) })),
          new Promise(r => setTimeout(r, REVEAL_DWELL_MS)),
        ])
        if (controller.signal.aborted) return
        dispatch({
          type: 'SHOW_PREVIEW', aiUrl: local.ai, originalUrl: local.original,
          sourceUrl: printShots[0], rawAiUrl: sheet, base: base ?? undefined,
          processingSec: Math.round((performance.now() - genStart) / 1000),
          direct: true, printSize: tmpl.print_size ?? '4R',
        })
      })()
        .catch(() => { if (!controller.signal.aborted) setTimedOut(true) })
        .finally(() => clearTimeout(timeout))
      return () => { controller.abort(); clearTimeout(timeout); clearInterval(interval) }
    }

    // Engine per-template: comfy menang atas generation_source (konsumen pertama engine_type).
    // Comfy selalu single-template (ga pernah multi-select) → templates[0] aman.
    if (state.templates[0].engine_type === 'comfy') {
      const controller = new AbortController()
      const timeout = setTimeout(() => { controller.abort(); setTimedOut(true) }, 120_000)
      comfyGenerate(state.imageUrl, state.templates[0], comfy, (pct) => dispatch({ type: 'SET_PROGRESS', progress: pct }), controller.signal)
        .then(async (aiUrl) => {
          if (controller.signal.aborted) return // StrictMode double-invoke / unmount — jangan dispatch
          const local = await localCopies(state.imageUrl, aiUrl, licensed)
          dispatch({ type: 'SET_PROGRESS', progress: 100 })
          // finalizeLocal jalan barengan dwell — base siap sebelum preview kebuka, no race
          const [base] = await Promise.all([
            finalizeLocal(eventName, local.original, local.ai,
              (err) => onUploadFailed?.({ stage: 'finalize', error: String(err).slice(0, 300) })),
            new Promise(r => setTimeout(r, REVEAL_DWELL_MS)),
          ])
          const videoUrl = await maybeAnimate(aiUrl, base ?? undefined)
          dispatch({
            type: 'SHOW_PREVIEW', aiUrl: local.ai, originalUrl: local.original,
            sourceUrl: state.imageUrl, rawAiUrl: aiUrl, base: base ?? undefined,
            processingSec: Math.round((performance.now() - genStart) / 1000), videoUrl,
          })
        })
        .catch(() => { if (!controller.signal.aborted) setTimedOut(true) })
        .finally(() => clearTimeout(timeout))
      return () => { controller.abort(); clearTimeout(timeout); clearInterval(interval) }
    }

    if (generationSource === 'LOCAL') {
      const controller = new AbortController()
      // Timeout scaled per template — N swaps sequential, jangan abort di tengah antrian.
      const timeout = setTimeout(() => { controller.abort(); setTimedOut(true) }, 120_000 * state.templates.length)
      // Sequential swap tiap template (HARAM Promise.all — proteksi hardware). 1 selfie mapping
      // dipakai semua. face_server returns clean; client burns both copies saat unlicensed.
      ;(async () => {
        const results: SwapResult[] = []
        const total = state.templates.length
        for (let i = 0; i < total; i++) {
          if (controller.signal.aborted) return
          setMultiIdx(i)
          const tmpl = state.templates[i]
          const templateUrl = tmpl.thumbnail_url ?? ''
          // Scale per-template pct ke rentang penuh 0-100 → bar ga reset tiap template (multi).
          // Single (total=1) → identik pct lama.
          const aiUrl = await localSwap(templateUrl, state.imageUrl, (pct) => dispatch({ type: 'SET_PROGRESS', progress: Math.round((i * 100 + pct) / total) }), state.faceMapping)
          const local = await localCopies(state.imageUrl, aiUrl, licensed)
          const base = await finalizeLocal(eventName, local.original, local.ai,
            (err) => onUploadFailed?.({ stage: 'finalize', error: String(err).slice(0, 300) }))
          results.push({
            templateId: tmpl.id, aiUrl: local.ai, originalUrl: local.original,
            sourceUrl: state.imageUrl, rawAiUrl: aiUrl, base: base ?? undefined,
            processingSec: Math.round((performance.now() - genStart) / 1000),
          })
        }
        dispatch({ type: 'SET_PROGRESS', progress: 100 })
        await new Promise(r => setTimeout(r, REVEAL_DWELL_MS)) // let the crisp reveal paint
        if (controller.signal.aborted) return
        if (results.length === 1) {
          // Single = jalur lama, byte-identik: langsung ke framechooser via SHOW_PREVIEW.
          const r = results[0]
          const videoUrl = await maybeAnimate(r.rawAiUrl ?? r.aiUrl, r.base)
          dispatch({
            type: 'SHOW_PREVIEW', aiUrl: r.aiUrl, originalUrl: r.originalUrl,
            sourceUrl: r.sourceUrl, rawAiUrl: r.rawAiUrl, base: r.base, processingSec: r.processingSec, videoUrl,
          })
        } else {
          // Multi = tamu pilih 1 dulu di grid chooser, baru masuk flow frame/preview.
          dispatch({ type: 'SET_STATE', state: { screen: 'resultchooser', results, imageUrl: state.imageUrl } })
        }
      })()
        .catch(() => { if (!controller.signal.aborted) setTimedOut(true) })
        .finally(() => clearTimeout(timeout))
      return () => { controller.abort(); clearTimeout(timeout); clearInterval(interval) }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort(); setTimedOut(true) }, 120_000)

    dispatch({ type: 'SET_PROGRESS', progress: 10 })
    fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: state.templates[0].id,
        image_base64: state.imageUrl,
        assignments: state.assignments,
      }),
      signal: controller.signal,
    })
      .then(async (res) => {
        dispatch({ type: 'SET_PROGRESS', progress: 90 })
        if (!res.ok) { setTimedOut(true); return }
        const { url } = await res.json()
        const local = await localCopies(state.imageUrl, url, licensed)
        dispatch({ type: 'SET_PROGRESS', progress: 100 })
        const [base] = await Promise.all([
          finalizeLocal(eventName, local.original, local.ai,
            (err) => onUploadFailed?.({ stage: 'finalize', error: String(err).slice(0, 300) })),
          new Promise(r => setTimeout(r, REVEAL_DWELL_MS)),
        ])
        const videoUrl = await maybeAnimate(url, base ?? undefined)
        dispatch({
          type: 'SHOW_PREVIEW', aiUrl: local.ai, originalUrl: local.original,
          sourceUrl: state.imageUrl, rawAiUrl: url, base: base ?? undefined,
          processingSec: Math.round((performance.now() - genStart) / 1000), videoUrl,
        })
      })
      .catch((err) => { if (err.name !== 'AbortError') setTimedOut(true) })
      .finally(() => clearTimeout(timeout))

    return () => { controller.abort(); clearTimeout(timeout); clearInterval(interval) }
  }, [timedOut]) // re-run kalau toggle error↔generate (dev preview via hash)

  if (timedOut) {
    return (
      <div className="screen-split screen-split--center flex flex-col w-full h-full overflow-hidden">
        <div className="screen-title text-center px-5 pt-5 pb-4">
          <h1
            className="h1-glow"
            style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}
          >
            {t('processing_error_title') as string}
          </h1>
          <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618 }}>
            {t('processing_error_subtitle') as string}
          </p>
        </div>
        <div className="screen-actions shrink-0 p-5 flex gap-3">
          <TouchButton variant="secondary" onClick={() => dispatch({ type: 'RESET' })} className="flex-1">
            {t('processing_start_over') as string}
          </TouchButton>
          <TouchButton onClick={() => dispatch({ type: 'RESET' })} className="flex-1">
            {t('processing_try_again') as string}
          </TouchButton>
        </div>
      </div>
    )
  }

  const pct = state.progress

  return (
    <div className="screen-split screen-split--center flex flex-col w-full h-full overflow-hidden">
      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1
          className="h1-glow"
          style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}
        >
          {t('processing_title') as string}
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618, whiteSpace: 'pre-line' }}>
          {/* ponytail: string inline — i18n buat status video YAGNI sampai diminta translate */}
          {animating ? 'Foto jadi! Lagi bikin videonya...' : (t('processing_subtitle') as string)}
        </p>
      </div>

      <div className="screen-content">
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center self-center gap-10 px-8 w-full max-w-sm pb-[35px]">

        {/* Denoise reveal of the CHOSEN TEMPLATE (falls back to selfie if it has no thumbnail) */}
        <RenderCosmetics src={(state.templates[multiIdx] ?? state.templates[0]).thumbnail_url || state.imageUrl || MOCK_AI_URL} pct={pct} />

        {/* Step indicators */}
        <div className="flex gap-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-col items-center gap-2">
              <div className="w-px h-4 transition-all duration-500" style={{
                background: i + 1 <= state.step ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.1)',
              }} />
              <span style={{
                fontSize: 'var(--text-2xs)', letterSpacing: '0.2em', textTransform: 'uppercase',
                color: i + 1 <= state.step ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.2)',
                transition: 'color 0.5s',
              }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="w-full space-y-2">
          <div style={{ height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4,
              background: 'linear-gradient(90deg, var(--brand), #00f5d4)',
              width: `${pct}%`, transition: 'width 0.7s ease',
            }} />
          </div>
          <div className="flex justify-between">
            <span style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>{pct}%</span>
            <span style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{generationSource}</span>
          </div>
        </div>

        {/* Multi-template progress — "Processing N/M…" (t() ga support interpolasi → concat) */}
        {state.templates.length > 1 && (
          <p style={{ fontSize: 'var(--text-sm)', color: '#a78bfa', letterSpacing: '0.05em', textAlign: 'center' }}>
            {t('processing_multi') as string} {multiIdx + 1}/{state.templates.length}…
          </p>
        )}

        {/* Rotating copy */}
        <p key={copyIndex} className="animate-fade-in" style={{
          fontSize: 'var(--text-sm)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618, textAlign: 'center',
        }}>
          {copy[copyIndex]}
        </p>
      </div>
      </div>
    </div>
  )
}


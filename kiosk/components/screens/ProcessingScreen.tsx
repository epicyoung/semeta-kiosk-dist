'use client'
import { useEffect, useRef, useState, type Dispatch } from 'react'
import { TouchButton } from '@/components/ui/TouchButton'
import { comfyGenerate, type ComfyCfg } from '@/lib/comfy'
import { proxied } from '@/lib/facedetect'
import { swapFace } from '@/lib/faceswap'
import type { GenerationSource, KioskAction, KioskState, SwapResult, VideoProvider } from '@/lib/types'
import { animateImage } from '@/lib/video'
import { uploadAsset, resizeDataUrl } from '@/lib/upload'
import { compositeFrame } from '@/lib/frame-composite'
import { composePrintLayout, to2UpSheet } from '@/lib/print-layout'
import { useT } from '@/lib/i18n'
import { finalizeLocal, localCopies } from '@/lib/local-finalize'
import { buildApiEditRequest } from '@/lib/api-engine'

// ponytail: dev mock — set false kalau backend nyata siap
const MOCK = false
const MOCK_MS = 10_000
const MOCK_AI_URL = '/photo-1488426862026-3ee34a7d66df.jpg'
// Video img2vid = MANUAL via tombol "Make Video" di preview (hemat FAL: cuma generate kalau
// tamu minta). Auto-generate OFF. Flip true kalau mau balik auto (maybeAnimate jalan lagi).
const AUTO_VIDEO = false

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
  videoUnlocked: boolean
  comfy: ComfyCfg
  enableVideoEngine: boolean
  videoProvider: VideoProvider
  videoResolution: '720p' | '1080p'
  // Key image engine hasil pilihan operator di Settings ('' = belum milih / ga ada yang
  // enabled ⇒ Worker pakai jalur lama per-template). Dirakit di KioskApp dari config.
  imageEngine: string
  // Jumlah variasi AI per jepretan (1-4, dipilih operator di Settings). Cuma kepake bareng
  // imageEngine — jalur lama per-template jumlahnya dari payload_json Supabase. Worker
  // clamp lagi & ngali harga sendiri; angka ini bukan sumber kebenaran tagihan.
  imageVariants: number
  onUploadFailed?: (metadata: Record<string, unknown>) => void
}

export function ProcessingScreen({ state, dispatch, generationSource, eventName, licensed, videoUnlocked, comfy, enableVideoEngine, videoProvider, videoResolution, imageEngine, imageVariants, onUploadFailed }: Props) {
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

  // Guard DOBEL FINALIZE: effect processing bisa jalan 2x (StrictMode dev, dep berubah, retry)
  // → dua promise generate → dua finalizeLocal → dua next-seq → file & entri microsite DOBEL
  // (#010 == #011, isi identik). next-seq counter mentah, ga dedup. Ref ini ngunci: finalize
  // cuma jalan SEKALI per mount sesi. Same filosofi kayak uploadedBase.current di R2 upload.
  const finalizedRef = useRef(false)
  const finalizeOnce: typeof finalizeLocal = async (...args) => {
    if (finalizedRef.current) return null // sesi ini udah di-finalize → run kedua no-op
    finalizedRef.current = true
    const base = await finalizeLocal(...args)
    if (!base) finalizedRef.current = false // finalize GAGAL → buka lagi biar retry beneran bisa
    return base
  }

  // Versi batch buat N variasi dari SATU generate (num_images > 1). Tiap variasi tetep dapet
  // seq sendiri (file & entri microsite kepisah), tapi guard-nya sama: sekali per sesi.
  // Tanpa ini, effect yang jalan 2x bikin 4 variasi jadi 8 file — bug bf04ca4 versi kali empat.
  const finalizeAllOnce = async (pairs: { original: string; ai: string }[]): Promise<(string | null)[]> => {
    if (finalizedRef.current) return pairs.map(() => null)
    finalizedRef.current = true
    const bases: (string | null)[] = []
    for (const p of pairs) {
      bases.push(await finalizeLocal(eventName, p.original, p.ai,
        (err) => onUploadFailed?.({ stage: 'finalize', error: String(err).slice(0, 300) })))
    }
    if (bases.every(b => !b)) finalizedRef.current = false // semua gagal → retry beneran boleh jalan
    return bases
  }

  // Magic Catcher DIPINDAH ke PreviewScreen (mulai pas tamu PERTAMA lihat hasil AI di
  // framechooser/preview — momen reaksi asli), BUKAN di sini pas layar loading generate.

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
      // Video MANUAL via tombol preview (AUTO_VIDEO=false) → hemat FAL, cuma pas tamu minta.
      // videoUnlocked = izin admin per-kiosk ATAU godmode (isVideoUnlocked di KioskApp).
      // Auto path ditinggal utuh buat flip nanti.
      if (!AUTO_VIDEO || !enableVideoEngine || !videoUnlocked) return undefined
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
        const tmpl = state.templates[0]
        const positive = tmpl?.video_positive_prompt ?? undefined
        const negative = tmpl?.video_negative_prompt ?? undefined
        const video = await animateImage(seedUrl, videoProvider, { resolution: videoResolution, positive, negative })
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
        dispatch({ type: 'SHOW_PREVIEW', aiUrl: local.ai, originalUrl: local.original, sourceUrl: state.imageUrl || MOCK_AI_URL, templateId: state.templates[0].id })
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
        let sheet = await composePrintLayout(printShots, tmpl)
        if (tmpl.print_size === '2R_STRIP') {
          sheet = await to2UpSheet(sheet)
        }
        if (controller.signal.aborted) return
        dispatch({ type: 'SET_PROGRESS', progress: 70 })
        // Watermark freemium tetep berlaku: display di-burn saat unlicensed, raw bersih
        // buat upload (Worker yang burn server-side). original = shot pertama (polos).
        const local = await localCopies(printShots[0], sheet, licensed)
        dispatch({ type: 'SET_PROGRESS', progress: 100 })
        const [base] = await Promise.all([
          finalizeOnce(eventName, local.original, local.ai,
            (err) => onUploadFailed?.({ stage: 'finalize', error: String(err).slice(0, 300) })),
          new Promise(r => setTimeout(r, REVEAL_DWELL_MS)),
        ])
        if (controller.signal.aborted) return
        dispatch({
          type: 'SHOW_PREVIEW', aiUrl: local.ai, originalUrl: local.original,
          sourceUrl: printShots[0], rawAiUrl: sheet, base: base ?? undefined,
          processingSec: Math.round((performance.now() - genStart) / 1000),
          direct: true, printSize: tmpl.print_size ?? '4R_PORTRAIT', templateId: tmpl.id,
        })
      })()
        .catch(() => { if (!controller.signal.aborted) setTimedOut(true) })
        .finally(() => clearTimeout(timeout))
      return () => { controller.abort(); clearTimeout(timeout); clearInterval(interval) }
    }

    // Engine per-template: comfy menang atas generation_source (konsumen pertama engine_type).
    // Multi-template DIDUKUNG di sini, persis kayak faceswap LOCAL di bawah: sequential
    // (HARAM Promise.all — satu GPU), tiap hasil masuk allResults. Ongkosnya GPU sendiri,
    // nol token per variasi, jadi jumlahnya boleh jadi dial operator. Bandingin engine API:
    // di sana tiap variasi = duit ke FAL, makanya jumlahnya dikunci server.
    if (state.templates[0].engine_type === 'comfy') {
      const controller = new AbortController()
      // Timeout ikut jumlah template — N generate sequential, jangan abort di tengah antrian.
      const timeout = setTimeout(() => { controller.abort(); setTimedOut(true) }, 120_000 * state.templates.length)
      ;(async () => {
        // ComfyUI toggle mati (operator lupa nyalain) → gagal cepat dalam detik, bukan
        // nunggu 120s×N timeout kosong buat request yang emang gak bakal pernah kejawab.
        const status = await fetch('http://localhost:8000/comfy/status').then(r => r.json()).catch(() => ({ alive: false }))
        if (!status.alive) throw new Error('ComfyUI belum aktif — nyalakan lewat Settings > Fullbody Engine')
        const results: SwapResult[] = []
        const total = state.templates.length
        for (let i = 0; i < total; i++) {
          if (controller.signal.aborted) return
          setMultiIdx(i)
          const tmpl = state.templates[i]
          // Skala pct per-template ke rentang penuh → bar ga reset tiap template.
          const aiUrl = await comfyGenerate(state.imageUrl, tmpl, comfy,
            (pct) => dispatch({ type: 'SET_PROGRESS', progress: Math.round((i * 100 + pct) / total) }),
            controller.signal)
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
        await new Promise(r => setTimeout(r, REVEAL_DWELL_MS))
        if (controller.signal.aborted) return // StrictMode double-invoke / unmount — jangan dispatch
        const r = results[0]
        const videoUrl = await maybeAnimate(r.rawAiUrl ?? r.aiUrl, r.base)
        dispatch({
          type: 'SHOW_PREVIEW', aiUrl: r.aiUrl, originalUrl: r.originalUrl,
          sourceUrl: r.sourceUrl, rawAiUrl: r.rawAiUrl, base: r.base,
          processingSec: r.processingSec, videoUrl, templateId: r.templateId,
          allResults: results.length > 1 ? results : undefined,
        })
      })()
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
          const aiUrl = await swapFace(templateUrl, state.imageUrl, (pct) => dispatch({ type: 'SET_PROGRESS', progress: Math.round((i * 100 + pct) / total) }), state.faceMappings?.[i])
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
        // Single & multi sama-sama langsung ke framechooser via SHOW_PREVIEW — NO resultchooser.
        // Multi bawa semua hasil (allResults) → preview nampilin 4-4nya di grid, flip Ori jadi satu
        // gede, print/video minta pilih pas ditekan (dialog udah ada). Hasil ke-0 = chosen default.
        const r = results[0]
        const videoUrl = await maybeAnimate(r.rawAiUrl ?? r.aiUrl, r.base)
        dispatch({
          type: 'SHOW_PREVIEW', aiUrl: r.aiUrl, originalUrl: r.originalUrl,
          sourceUrl: r.sourceUrl, rawAiUrl: r.rawAiUrl, base: r.base, processingSec: r.processingSec, videoUrl, templateId: r.templateId,
          allResults: results.length > 1 ? results : undefined,
        })
      })()
        .catch(() => { if (!controller.signal.aborted) setTimedOut(true) })
        .finally(() => clearTimeout(timeout))
      return () => { controller.abort(); clearTimeout(timeout); clearInterval(interval) }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort(); setTimedOut(true) }, 120_000)

    dispatch({ type: 'SET_PROGRESS', progress: 10 })
    // Engine 'api' (Nano Banana Pro): prompt + referensi BG nyusul di body. Referensi
    // di-load duluan jadi data URI — kalau ada yang gagal, buildApiEditRequest ngelempar
    // dan generate batal SEBELUM token kepotong (bukan bikin hasil tanpa BG).
    // Timing per tahap — nyari di mana detiknya kebakar: resize Canon 6000px di canvas,
    // nunggu Google, atau burn watermark lokal. Semua relatif ke genStart (performance.now,
    // immune dari jam OS). Angka dalam detik biar kebaca pas berdiri di depan booth.
    const lap = (label: string, extra?: Record<string, unknown>) =>
      console.log(`[gen] ${label} @${((performance.now() - genStart) / 1000).toFixed(1)}s`, extra ?? '')

    const prepareApiPayload = async () => {
      if (state.templates[0].engine_type !== 'api') return { edit: null, selfieBase64: state.imageUrl }
      const [edit, selfieBase64] = await Promise.all([
        buildApiEditRequest(state.templates[0], state.userInput),
        resizeDataUrl(state.imageUrl, 1200).catch(() => state.imageUrl),
      ])
      // Panjang data URI ≈ 1.37× ukuran byte asli — cukup buat mastiin resize beneran kena
      // (~200KB) dan bukan diam-diam ngirim full-res gara-gara .catch() di atas.
      lap('payload siap', {
        selfieKB: Math.round(selfieBase64.length / 1024),
        refs: edit?.reference_images?.length ?? 0,
      })
      return { edit, selfieBase64 }
    }
    prepareApiPayload()
      .then(({ edit, selfieBase64 }) => fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: state.templates[0].billing_id || state.templates[0].id,
          image_base64: selfieBase64,
          assignments: state.assignments,
          // Cuma dikirim kalau operator beneran milih. Kosong ⇒ field-nya ga ada sama sekali
          // ⇒ Worker jatuh ke deduct_token per-template (kelakuan lama). Kiosk NYEBUT key doang;
          // model, resolusi, jumlah variasi & harga tetap diputus server dari registry-nya.
          // num_images cuma nyusul kalau image_engine kekirim — di jalur lama jumlahnya
          // milik payload_json Supabase, dan ngirimnya malah bikin Worker bingung sumbernya.
          ...(imageEngine ? { image_engine: imageEngine, num_images: imageVariants } : {}),
          ...(edit ?? {}),
        }),
        signal: controller.signal,
      }))
      .then(async (res) => {
        dispatch({ type: 'SET_PROGRESS', progress: 90 })
        // Ini lap paling penting: selisih dari 'payload siap' = murni waktu Worker + Google.
        // Kalau angka ini yang gede, nambah RAM/CPU booth ga nolong — itu antrian di Google.
        lap('worker balas', { status: res.status })
        if (!res.ok) { setTimedOut(true); return }
        // urls = semua variasi (num_images dari payload_json Supabase). Worker lama yang
        // cuma balikin `url` tetep kelayan lewat fallback ini.
        const { url, urls } = await res.json()
        const list: string[] = Array.isArray(urls) && urls.length > 0 ? urls : [url]
        lap('hasil diterima', { variasi: list.length })

        // Sequential, HARAM Promise.all: tiap localCopies bikin canvas full-res buat burn
        // watermark — empat sekaligus bikin mesin lapangan mepet memori.
        const locals: { raw: string; original: string; ai: string }[] = []
        for (const u of list) locals.push({ raw: u, ...(await localCopies(state.imageUrl, u, licensed)) })
        dispatch({ type: 'SET_PROGRESS', progress: 100 })
        // Sengaja sesudah loop, bukan per-item: yang dicari total ongkos burn watermark buat
        // N variasi — itu yang naik linear dan bikin 4 variasi kerasa lebih berat dari 2.
        lap('watermark selesai')

        const [bases] = await Promise.all([
          finalizeAllOnce(locals.map(l => ({ original: l.original, ai: l.ai }))),
          new Promise(r => setTimeout(r, REVEAL_DWELL_MS)),
        ])
        lap('frame selesai')
        const results: SwapResult[] = locals.map((l, i) => ({
          templateId: state.templates[0].id,
          aiUrl: l.ai, originalUrl: l.original,
          sourceUrl: state.imageUrl, rawAiUrl: l.raw,
          base: bases[i] ?? undefined,
          processingSec: Math.round((performance.now() - genStart) / 1000),
        }))
        // Variasi ke-0 = default kepilih. Sama persis bentuknya kayak multi-template lokal,
        // jadi grid pemilih + planMultiUpload + print/video di PreviewScreen kepake apa adanya.
        const r0 = results[0]
        const base = r0.base ?? null
        const videoUrl = await maybeAnimate(r0.rawAiUrl ?? r0.aiUrl, base ?? undefined)
        // Total sampai preview kebuka. Kalau lompatnya jauh dari 'frame selesai', berarti
        // yang makan waktu video provider — bukan jalur foto sama sekali.
        lap('SELESAI', { video: videoUrl ? 'ya' : 'ga' })
        dispatch({
          type: 'SHOW_PREVIEW', aiUrl: r0.aiUrl, originalUrl: r0.originalUrl,
          allResults: results.length > 1 ? results : undefined,
          sourceUrl: r0.sourceUrl, rawAiUrl: r0.rawAiUrl, base: base ?? undefined,
          processingSec: r0.processingSec, videoUrl, templateId: r0.templateId,
        })
      })
      // Log dulu baru layar error: sebabnya (referensi ga ke-load / FAL nolak) cuma
      // kelihatan di sini. Tanpa ini operator cuma liat "gagal" tanpa petunjuk apa pun.
      .catch((err) => {
        if (err?.name === 'AbortError') return
        console.error('[generate] gagal:', err)
        setTimedOut(true)
      })
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
          {state.templates[0]?.engine_type === 'print' ? 'Crafting Layout' : t('processing_title') as string}
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618, whiteSpace: 'pre-line' }}>
          {/* ponytail: string inline — i18n buat status video YAGNI sampai diminta translate */}
          {state.templates[0]?.engine_type === 'print' ? 'Please wait while we prepare your print layout...' : animating ? 'Foto jadi! Lagi bikin videonya...' : (t('processing_subtitle') as string)}
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
            <span style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {state.templates[0]?.engine_type === 'print'
                ? 'PRINT'
                : generationSource === 'LOCAL'
                ? 'LOCAL AI'
                : imageEngine?.includes('google')
                ? 'GOOGLE AI'
                : imageEngine?.includes('fal')
                ? 'FAL AI'
                : generationSource === 'fal'
                ? 'AI ENGINE'
                : generationSource}
            </span>
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


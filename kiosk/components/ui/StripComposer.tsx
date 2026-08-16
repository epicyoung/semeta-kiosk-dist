'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/lib/i18n'
import { TouchButton } from './TouchButton'
import type { Ai4RLayout } from '@/lib/types'
import type { StripSource } from '@/lib/strip-pool'
import type { SlotTransform } from '@/lib/print-layout'

type PrintLayoutMode = '2R_STRIP' | '4R_LANDSCAPE'

type Props = {
  pool: StripSource[]
  slots: number
  printing: boolean
  error: boolean
  overlayUrl?: string | null
  overlay4rUrl?: string | null
  ai4rLayout?: Ai4RLayout
  require4rOverlay?: boolean
  onCancel: () => void
  onConfirm: (
    picked: { source: StripSource; transform: SlotTransform }[],
    mode: PrintLayoutMode
  ) => void
}

export function StripComposer({
  pool,
  slots,
  printing,
  error,
  overlayUrl,
  overlay4rUrl,
  ai4rLayout = 'GRID_4',
  require4rOverlay = false,
  onCancel,
  onConfirm,
}: Props) {
  const t = useT()
  const [mode, setMode] = useState<PrintLayoutMode>('2R_STRIP')
  // Array PANJANG TETAP sepanjang jumlah slot, `null` = slot kosong. Dulu ini array padat
  // yang di-splice pas hapus, jadi buang slot 1 bikin isi 2/3/4 naik semua — foto pindah
  // tempat sendiri padahal tamu cuma mau ngosongin satu. Index = slot, titik.
  const [picked, setPicked] = useState<(string | null)[]>(() => Array(slots).fill(null))
  type FitAxis = 'width' | 'height'
  const [transforms, setTransforms] = useState<Record<number, { scale: number; x: number; y: number; fit: FitAxis; rotation: number }>>({})
  const [activeSlot, setActiveSlot] = useState<number | null>(null)

  const dragStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null)
  const isDraggingRef = useRef(false)
  // Double-tap: slot mana & kapan tap terakhir. Dipisah dari drag lewat ambang geser —
  // di layar sentuh jari SELALU gerak beberapa piksel, jadi "ga gerak sama sekali" bukan
  // syarat yang bisa dipenuhi tamu.
  const lastTapRef = useRef<{ slot: number; at: number } | null>(null)
  const DOUBLE_TAP_MS = 320
  const TAP_SLOP_PX = 8
  // Seret-buat-geser di kolam foto — MOUSE DOANG. Layar sentuh udah bisa di-swipe sendiri
  // lewat overflow-x native; kalau shim ini ikut jalan di jari, scroll-nya kehitung dua kali
  // dan kerasa ngebut. Mouse yang ga punya padanan: scrollbar-nya disembunyiin, dan drag di
  // kontainer overflow emang ga ada bawaannya di browser.
  const poolRef = useRef<HTMLDivElement | null>(null)
  const poolDragRef = useRef<{ startX: number; startScroll: number; moved: number } | null>(null)

  const handlePoolDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || !poolRef.current) return
    poolDragRef.current = { startX: e.clientX, startScroll: poolRef.current.scrollLeft, moved: 0 }
  }

  const handlePoolMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = poolDragRef.current
    if (!d || !poolRef.current) return
    const dx = e.clientX - d.startX
    d.moved = Math.max(d.moved, Math.abs(dx))
    poolRef.current.scrollLeft = d.startScroll - dx
  }

  // Seret yang lewat ambang JANGAN ikut jadi klik — kalau enggak, tiap selesai nggeser
  // kolam, kartu yang kebetulan ada di bawah kursor ikut masuk slot.
  const handlePoolUpCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = poolDragRef.current
    poolDragRef.current = null
    if (d && d.moved > TAP_SLOP_PX) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // Cubit: semua pointer yang lagi nempel + jarak awal antar dua jari sebagai acuan zoom.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null)
  const MIN_SCALE = 0.5
  const MAX_SCALE = 3.5
  const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number(s.toFixed(2))))

  // Portal ke #glass-panel, BUKAN ke body. Screen biasa dirender di dalam kotak
  // `inset: var(--pad-screen)` + `overflow:hidden` — itu sumber celah 20px di empat sisi,
  // dan ga bisa ditembus dari dalam karena keburu keklip. Naik satu tingkat ke panel kaca =
  // mepet tepi, tapi wordmark & footer di luar panel tetep kelihatan.
  const [panel, setPanel] = useState<HTMLElement | null>(null)
  useEffect(() => setPanel(document.getElementById('glass-panel')), [])

  const is4R = mode === '4R_LANDSCAPE'
  const activeSlots = is4R
    ? (ai4rLayout === 'TRIO_3' || ai4rLayout === 'GRID_3' ? 3 : ai4rLayout === 'SPLIT_2' ? 2 : 4)
    : slots
  const activeOverlay = is4R ? overlay4rUrl : overlayUrl

  // Nama layout DILEPAS dari label tab — tab-nya cuma dua kata biar kebaca sekali lihat.
  // Detailnya turun ke subtitle, tempat yang emang buat penjelasan.
  const layoutName =
    ai4rLayout === 'TRIO_3' ? '1+2 Trio'
    : ai4rLayout === 'GRID_3' ? '1×3 Grid'
    : ai4rLayout === 'SPLIT_2' ? '1×2 Split'
    : '2×2 Grid'

  const fourRLocked = require4rOverlay && !overlay4rUrl

  const slotOf = (id: string) => picked.indexOf(id)
  const filled = picked.slice(0, activeSlots).filter(Boolean).length
  // "Penuh" = SEMUA slot keisi, bukan sekadar ada isinya. Slot bolong = bidang putih di
  // kertas yang udah kepotong dan ga bisa dibatalin.
  const isFull = filled >= activeSlots

  // Default 'width': lebar foto = lebar slot, apa pun orientasinya. Bisa ketebak — beda
  // sama cover/contain yang milih sumbunya sendiri tergantung rasio tiap foto.
  const getTransform = (i: number) => transforms[i] || { scale: 1, x: 0, y: 0, fit: 'width' as FitAxis, rotation: 0 }

  const handleModeSwitch = (nextMode: PrintLayoutMode) => {
    if (printing || nextMode === mode) return
    // Tab-nya udah kelihatan terkunci + alasannya ada di bawah subtitle. alert() di layar
    // sentuh lapangan = dialog OS yang nutupin kiosk dan cuma bisa ditutup pakai mouse.
    if (nextMode === '4R_LANDSCAPE' && fourRLocked) return
    setMode(nextMode)
    // Panjang array ngikut jumlah slot mode baru; isi per-index dipertahanin.
    const targetSlots = nextMode === '4R_LANDSCAPE' ? 4 : slots
    setPicked(Array.from({ length: targetSlots }, (_, i) => picked[i] ?? null))
  }

  const fill = (id: string) => {
    if (printing || picked.includes(id)) return
    // Masuk ke slot KOSONG PERTAMA — jadi sesudah tamu ngosongin slot 1, pilihan berikutnya
    // balik ke slot 1 itu, bukan nempel di ekor.
    const at = picked.slice(0, activeSlots).findIndex(p => p === null)
    if (at < 0) return
    const next = [...picked]
    next[at] = id
    setPicked(next)
    setActiveSlot(at)
  }

  const clear = (i: number) => {
    if (printing) return
    const next = [...picked]
    next[i] = null
    setPicked(next)
    // Transform ikut slot, bukan ikut foto — slot yang dikosongin di-reset, tetangganya
    // JANGAN disentuh (dulu key transform ikut kegeser pas array di-splice).
    setTransforms(prev => {
      const n = { ...prev }
      delete n[i]
      return n
    })
    if (activeSlot === i) setActiveSlot(null)
  }

  const handlePointerDown = (i: number, e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // safe fallback
    }
    setActiveSlot(i)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // Jari kedua turun = cubit dimulai. Seretan yang lagi jalan dibatalin (bukan diterusin
    // barengan) — nahan satu jari sambil cubit bikin foto ngacir ke sudut.
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = { startDist: Math.hypot(a.x - b.x, a.y - b.y), startScale: getTransform(i).scale }
      isDraggingRef.current = false
      dragStartRef.current = null
      return
    }

    isDraggingRef.current = true
    const current = getTransform(i)
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startX: current.x,
      startY: current.y,
    }
  }

  const handlePointerMove = (i: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    // ── Cubit: jarak antar dua jari : jarak awal = pengali zoom ──────────────────
    const pinch = pinchRef.current
    if (pinch && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch.startDist > 0) {
        const next = clampScale(pinch.startScale * (dist / pinch.startDist))
        setTransforms(prev => {
          const current = prev[i] || { scale: 1, x: 0, y: 0, fit: 'width' as FitAxis, rotation: 0 }
          return { ...prev, [i]: { ...current, scale: next } }
        })
      }
      return
    }

    const start = dragStartRef.current
    if (!isDraggingRef.current || !start) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const deltaX = (e.clientX - start.pointerX) / rect.width
    const deltaY = (e.clientY - start.pointerY) / rect.height
    // Batas geser IKUT zoom. Dulu dipatok ±1.0 (satu lebar slot) di semua level zoom —
    // pas foto di-zoom 3,5× tepinya ada di 1,25 lebar slot, jadi sisi jauhnya mentok ga
    // keburu ke-frame: kerasa kayak seretannya nyangkut padahal fotonya masih ada.
    const lim = Math.max(1, getTransform(i).scale)
    const targetX = Math.max(-lim, Math.min(lim, start.startX + deltaX))
    const targetY = Math.max(-lim, Math.min(lim, start.startY + deltaY))

    setTransforms(prev => {
      const current = prev[i] || { scale: 1, x: 0, y: 0, fit: 'width' as FitAxis, rotation: 0 }
      return {
        ...prev,
        [i]: {
          ...current,
          x: targetX,
          y: targetY,
        },
      }
    })
  }

  const handlePointerUp = (i: number, e?: React.PointerEvent<HTMLDivElement>) => {
    if (e?.currentTarget && typeof e.currentTarget.releasePointerCapture === 'function') {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // safe fallback
      }
    }
    if (e) pointersRef.current.delete(e.pointerId)

    // Angkat jari sesudah cubit JANGAN dihitung tap — kalau enggak, tiap selesai zoom
    // sumbu fit-nya ikut kebalik sendiri.
    const wasPinching = pinchRef.current !== null
    if (pointersRef.current.size < 2) pinchRef.current = null

    // Tap = pointer turun-naik tanpa geser jauh. Kalau tamu beneran nyeret, JANGAN dihitung
    // tap — kalau enggak, tiap selesai geser bisa kepicu ganti sumbu fit.
    const start = dragStartRef.current
    const moved = start && e
      ? Math.hypot(e.clientX - start.pointerX, e.clientY - start.pointerY)
      : Infinity
    if (!wasPinching && moved <= TAP_SLOP_PX) {
      const now = Date.now()
      const last = lastTapRef.current
      if (last && last.slot === i && now - last.at <= DOUBLE_TAP_MS) {
        flipFit(i)
        lastTapRef.current = null   // tap ke-3 mulai hitungan baru, bukan nerusin
      } else {
        lastTapRef.current = { slot: i, at: now }
      }
    }

    isDraggingRef.current = false
    dragStartRef.current = null
  }

  // Mouse ga bisa nyubit. Roda = padanannya di mesin yang pakai mouse (dev & operator).
  const handleWheel = (i: number, e: React.WheelEvent<HTMLDivElement>) => {
    setTransforms(prev => {
      const current = prev[i] || { scale: 1, x: 0, y: 0, fit: 'width' as FitAxis, rotation: 0 }
      return { ...prev, [i]: { ...current, scale: clampScale(current.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)) } }
    })
  }

  // Double-tap gonta-ganti sumbu: lebar → tinggi → lebar. Zoom & geser di-reset karena
  // titik acuannya berubah — nilai lama bikin foto loncat ke posisi yang ga masuk akal.
  const flipFit = (i: number) => {
    setTransforms(prev => {
      const current = prev[i] || { scale: 1, x: 0, y: 0, fit: 'width' as FitAxis, rotation: 0 }
      const next: FitAxis = current.fit === 'width' ? 'height' : 'width'
      return { ...prev, [i]: { ...current, fit: next, scale: 1, x: 0, y: 0 } }
    })
  }

  // rotate90() & resetTransform() dicabut bareng baris tombolnya. Field `rotation` SENGAJA
  // ditinggal di transform (selalu 0): composePrintLayout masih ngitung dia buat nuker w/h
  // di fitAxis dan digabung sama rotasi slot custom Layout Studio (s.r). Nyabut field-nya
  // = nyabut jalur itu juga, padahal ga ada hubungannya sama tombol yang dibuang.

  const confirm = () => {
    // Wajib penuh: composePrintLayout mapping shot→slot by INDEX, jadi satu slot bolong
    // bukan cuma "kurang satu foto" — dia nggeser semua foto sesudahnya ke slot yang salah.
    if (printing || !isFull) return
    onConfirm(
      picked.slice(0, activeSlots).map((id, i) => ({
        source: pool.find(p => p.id === id)!,
        transform: getTransform(i),
      })),
      mode
    )
  }

  if (!panel) return null

  return createPortal(
    <div
      className="absolute inset-0 z-[60] animate-fade-in"
      style={{ background: 'rgba(9,1,53,0.95)', backdropFilter: 'blur(20px)', borderRadius: 'inherit', overflow: 'clip' }}
    >
      {/* Kerangka SAMA PERSIS kayak screen lain (lihat PreviewScreen): judul+aksi kiri,
          konten kanan pas landscape — otomatis lewat .screen-split, nol JS. Sebelumnya
          komponen ini punya grid sendiri (md:flex-row) yang arahnya kebalik dari screen
          lain, makanya kelihatan lompat-lompat tiap ganti layar. */}
      <div className="screen-split screen-split--center flex flex-col w-full h-full">
        <div className="screen-title text-center px-5 pt-5 pb-4">
          <h1
            className="h1-glow"
            style={{ fontSize: 'clamp(28px,4.2vw,42px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}
          >
            {t(is4R ? 'strip_title_4r' : 'strip_title') as string}
          </h1>
          {/* Penghitung slot: satu-satunya penjelasan kenapa tombol Print masih mati.
              Tanpa ini tamu nekan tombol abu-abu berkali-kali tanpa tau kurang apa. */}
          <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618 }}>
            {isFull ? (t('strip_hint_full') as string) : (t('strip_hint') as string)}
            {` · ${filled}/${activeSlots}`}
            {is4R && ` · ${layoutName}`}
          </p>

          {/* Tab di BAWAH judul. Style disalin dari TabSwitcher PHOTO|VIDEO di PreviewScreen
              (radius 10/7, padding 3 & 6x20, text-xs, aktif = rgba(255,255,255,0.2)) — sengaja
              bukan ungu brand: dua switcher yang beda rupa di layar yang sama bikin tamu
              ngira fungsinya beda. Isinya dua kata; nama layout ada di subtitle. */}
          <div className="mt-4 flex items-center justify-center">
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(12px)', borderRadius: 10, padding: 3, gap: 3 }}>
              {([
                { key: '2R_STRIP', label: 'Layout', locked: false },
                { key: '4R_LANDSCAPE', label: '4R Postcard', locked: fourRLocked },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => handleModeSwitch(tab.key)}
                  disabled={printing || tab.locked}
                  aria-pressed={mode === tab.key}
                  style={{
                    padding: '6px 20px',
                    borderRadius: 7,
                    border: 'none',
                    cursor: tab.locked ? 'default' : 'pointer',
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 500,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s',
                    background: mode === tab.key ? 'rgba(255,255,255,0.2)' : 'transparent',
                    color: mode === tab.key
                      ? '#fff'
                      : tab.locked ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.5)',
                  }}
                >
                  {tab.locked ? '🔒 ' : ''}{tab.label}
                </button>
              ))}
            </div>
          </div>
          {fourRLocked && (
            <p style={{ fontSize: 'var(--text-2xs)', color: '#ffcc66', marginTop: 8 }}>
              {t('strip_locked_4r') as string}
            </p>
          )}
        </div>

        <div className="screen-content">
          {/* Panggung kanvas. .composer-stage = container query; .composer-paper ngunci
              rasio kertas asli (2R 1:3, 4R 3:2) tanpa bisa jebol — lihat globals.css. */}
          <div className="composer-stage flex-1 min-h-0 w-full flex items-center justify-center" style={{ padding: 4 }}>
            <div
              className="composer-paper relative overflow-hidden rounded-[12px]"
              style={{
                ['--paper-w' as string]: is4R ? 3 : 1,
                ['--paper-h' as string]: is4R ? 2 : 3,
                background: '#0a0a0a',
                boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
              }}
            >
              {/* Frame Overlay (Live preview overlay) */}
              {activeOverlay && (
                <img
                  src={activeOverlay}
                  alt="Overlay"
                  className="absolute inset-0 z-20 h-full w-full object-cover pointer-events-none"
                />
              )}
  
              {/* Grid Container for Slots */}
              <div className={
                is4R
                  ? ai4rLayout === 'GRID_3'
                    ? 'grid grid-cols-3 grid-rows-1 h-full w-full'
                    : ai4rLayout === 'SPLIT_2'
                    ? 'grid grid-cols-2 grid-rows-1 h-full w-full'
                    : 'grid grid-cols-2 grid-rows-2 h-full w-full'
                  : 'flex flex-col h-full w-full'
              }>
                {Array.from({ length: activeSlots }, (_, i) => {
                  const src = picked[i] ? pool.find(p => p.id === picked[i]) : undefined
                  const tf = getTransform(i)
                  const isTrioHero = is4R && ai4rLayout === 'TRIO_3' && i === 0
  
                  return (
                    <div
                      key={i}
                      // Strip: flex-1 bagi rata, JANGAN height:100/N% — kalau slotnya diubah
                      // di Settings, persentase manual gampang ga sinkron sama jumlah slot.
                      // Slot terisi → papan catur PUTIH: sisa letterbox mode ↕ tinggi bakal
                      // kecetak putih (composePrintLayout ngecat kanvasnya '#ffffff'), jadi
                      // nadanya wajib nada kertas. Slot kosong → papan catur GELAP, nyatu
                      // sama panel: belum ada keputusan di situ, bukan area cetak.
                      className={`relative block w-full overflow-hidden border border-white/5 checker ${src ? '' : 'checker--void'} ${is4R ? 'h-full' : 'flex-1 min-h-0'} ${isTrioHero ? 'col-span-1 row-span-2' : ''}`}
                      style={{ ['--checker-size' as string]: is4R || activeSlots >= 3 ? '10px' : '14px' }}
                    >
                      {src ? (
                        <div className="relative h-full w-full overflow-hidden">
                          {/* Semua kontrol = gestur, nol tombol: seret geser, cubit zoom,
                              ketuk 2x ganti sumbu fit. `touch-none` wajib — tanpa itu
                              browser ngambil alih cubitnya buat zoom halaman. */}
                          <div
                            onPointerDown={(e) => handlePointerDown(i, e)}
                            onPointerMove={(e) => handlePointerMove(i, e)}
                            onPointerUp={(e) => handlePointerUp(i, e)}
                            onPointerCancel={(e) => handlePointerUp(i, e)}
                            onWheel={(e) => handleWheel(i, e)}
                            className="h-full w-full touch-none cursor-grab active:cursor-grabbing flex items-center justify-center"
                          >
                            {/* Sumbu fit diatur lewat UKURAN, bukan object-fit. object-fit
                                cuma punya cover (sumbu terbesar) & contain (terkecil) — dua
                                -duanya milih sumbunya sendiri tergantung rasio foto, jadi
                                hasilnya beda-beda antar foto. w-full/h-auto = lebar SELALU
                                pas slot, apa pun orientasinya; kelebihan tingginya kena clip
                                slot. Persis rumus fitAxis() di print-layout.ts. */}
                            <img
                              src={src.thumbUrl}
                              alt=""
                              draggable={false}
                              className="max-w-none select-none pointer-events-none transition-transform duration-75"
                              style={{
                                width: tf.fit === 'width' ? '100%' : 'auto',
                                height: tf.fit === 'width' ? 'auto' : '100%',
                                transform: `translate(${tf.x * 100}%, ${tf.y * 100}%) scale(${tf.scale}) rotate(${tf.rotation}deg)`,
                                transformOrigin: 'center center',
                              }}
                            />
                          </div>
  
                          {/* Header Controls (indikator + Delete)
                              pointer-events-none di BARISnya, auto di tiap tombol — dulu
                              seluruh pita atas & bawah nelen sentuhan selebar slot, jadi di
                              kotak 4R yang mungil sisa area buat nyeret tinggal secuil di
                              tengah. Sekarang yang nangkep cuma tombolnya sendiri. */}
                          <div className="absolute inset-x-1 top-1 z-30 flex items-center justify-between pointer-events-none">
                            {/* Satu badge STATUS doang — tombol fit-nya dicabut, ganti double-tap.
                                Sumbu aktif ikut nempel di sini: begitu kontrolnya jadi gestur,
                                ga ada lagi yang nunjukin mode sekarang kalau badge ini bisu. */}
                            <span
                              className={`flex items-center rounded-full text-white backdrop-blur-md ${is4R || activeSlots >= 3 ? 'gap-1 px-1.5 py-0.5 text-[8px]' : 'gap-1.5 px-2 py-0.5 text-[10px]'}`}
                              style={{ background: 'rgba(0,0,0,0.65)' }}
                            >
                              <span>🔍 {(tf.scale * 100).toFixed(0)}%</span>
                              <span style={{ opacity: 0.45 }}>|</span>
                              <span style={{ letterSpacing: '0.06em' }}>
                                {tf.fit === 'width'
                                  ? `↔ ${t('strip_fit_width') as string}`
                                  : `↕ ${t('strip_fit_height') as string}`}
                              </span>
                            </span>
                            <button
                              onClick={() => clear(i)}
                              className={`pointer-events-auto flex items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-95 ${is4R || activeSlots >= 3 ? 'h-5 w-5 text-xs' : 'h-7 w-7 text-sm'}`}
                              style={{ background: 'rgba(220,38,38,0.85)', lineHeight: 1 }}
                            >
                              ×
                            </button>
                          </div>
  
                        </div>
                      ) : (
                        <span
                          className="absolute inset-2 z-10 flex items-center justify-center rounded-[4px]"
                          style={{ border: '2px dashed rgba(255,255,255,0.25)', color: 'rgba(255,255,255,0.4)', fontSize: 'var(--text-xl)', fontWeight: 600 }}
                        >
                          {i + 1}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Kolam foto — sejajar frame chooser di PreviewScreen: baris kedua di dalam
              .screen-content, di bawah media, bukan kolom sendiri.
              SATU BARIS yang di-swipe, bukan wrap: 4 variasi AI + N foto asli gampang jadi
              8 kartu, dan versi wrap-nya makan tinggi berlapis-lapis sampai kanvasnya
              kegencet. `w-max mx-auto` = ketengah kalau sedikit, nge-scroll kalau banyak. */}
          <div
            ref={poolRef}
            onPointerDown={handlePoolDown}
            onPointerMove={handlePoolMove}
            onPointerUpCapture={handlePoolUpCapture}
            onPointerCancelCapture={handlePoolUpCapture}
            onPointerLeave={() => { poolDragRef.current = null }}
            className="strip-pool-scroll shrink-0 overflow-x-auto overflow-y-hidden px-2 pt-3 pb-1"
            style={{
              touchAction: 'pan-x',
              overscrollBehaviorX: 'contain',
              WebkitOverflowScrolling: 'touch',
              // Kabut di dua tepi = petunjuk "masih ada lagi ke samping". Scrollbar-nya
              // disembunyiin, jadi tanpa ini kolam yang kepanjangan kelihatan kayak udah abis.
              maskImage: 'linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent)',
              WebkitMaskImage: 'linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent)',
            }}
          >
            <div className="flex w-max mx-auto gap-2.5 items-center px-1">
              {pool.map(src => {
                const at = slotOf(src.id)
                const used = at >= 0
                return (
                  <button
                    key={src.id}
                    type="button"
                    // Kartu kepilih ditekan lagi = KELUAR dari slotnya. Dulu dia di-disable,
                    // jadi satu-satunya jalan batal cuma × di artboard — dan pas strip udah
                    // penuh, SEMUA kartu mati sekaligus: tamu ga bisa nuker pilihan, cuma
                    // bisa mundur ke artboard. Kartu ini yang dia tunjuk, di sini juga
                    // batalnya.
                    onClick={() => (used ? clear(at) : fill(src.id))}
                    disabled={(!used && isFull) || printing}
                    aria-pressed={used}
                    title={used ? (t('strip_slot_clear') as string) : undefined}
                    // draggable=false: browser bawaannya nge-drag <img> jadi ghost image,
                    // dan itu ngebajak seretan sebelum shim scroll sempat jalan.
                    draggable={false}
                    className="relative flex-none overflow-hidden rounded-[10px] transition-transform duration-200 active:scale-[0.96]"
                    style={{
                      width: 110,
                      maxWidth: 110,
                      aspectRatio: '3 / 4',
                      border: used ? '2px solid var(--brand)' : '1px solid rgba(255,255,255,0.14)',
                      // Kepilih = redup TAPI jangan seredup yang mati. Dulu 0.4 sama-sama
                      // dipakai buat "udah dipakai" dan bacaan "ga bisa diapa-apain";
                      // sekarang dia bisa ditekan, jadi harus kelihatan hidup.
                      opacity: used ? 0.75 : isFull ? 0.4 : 1,
                      cursor: !used && isFull ? 'default' : 'pointer',
                    }}
                  >
                    <img src={src.thumbUrl} alt="" draggable={false} className="h-full w-full object-cover pointer-events-none" />
                    {used && (
                      <span
                        className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full shadow-md"
                        style={{ background: 'var(--brand)', color: 'var(--brand-fg)', fontSize: 'var(--text-2xs)', fontWeight: 700 }}
                      >
                        {at + 1}
                      </span>
                    )}
                    <span
                      className="absolute inset-x-0 bottom-0 py-0.5 text-center font-medium"
                      style={{ background: 'rgba(9,1,53,0.85)', fontSize: '9px', color: 'var(--fg)' }}
                    >
                      {src.kind === 'original' ? (t('strip_label_original') as string) : (t('strip_label_ai') as string)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

        </div>

        <div className="screen-actions shrink-0 p-5">
          <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-subtle)', margin: '0 0 8px', textAlign: 'center' }}>
            💡 {t('strip_tip') as string}
          </p>
          {error && (
            <p role="alert" style={{ fontSize: 'var(--text-xs)', color: '#ff8a8a', margin: '0 0 8px', textAlign: 'center' }}>
              {t('strip_print_failed') as string}
            </p>
          )}
          {/* Dua tombol lebar sama + panah, persis kayak nav "← Previous | Next →" di screen
              lain: secondary buat mundur, primary buat maju. Ungu solid var(--brand) dicabut
              — di seluruh kiosk ga ada satu pun tombol aksi yang diisi warna penuh, jadi yang
              di sini kelihatan kayak komponen dari aplikasi lain. */}
          <div className="flex gap-3">
            <TouchButton variant="secondary" onClick={onCancel} disabled={printing} className="flex-1">
              {t('nav_back') as string}
            </TouchButton>
            <TouchButton
              onClick={confirm}
              disabled={!isFull || printing}
              className="flex-1"
            >
              {printing
                ? (t('preview_printing') as string)
                : `${t(is4R ? 'strip_print_4r' : 'strip_print_btn') as string} →`}
            </TouchButton>
          </div>
        </div>
      </div>
    </div>,
    panel,
  )
}

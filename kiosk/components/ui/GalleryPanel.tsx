'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { entryQrUrl, galleryEventId, galleryImageUrl, type GalleryEntry, type GalleryVariant } from '@/lib/gallery'
import { printGalleryVariant } from '@/lib/gallery-client'
import type { PrintSize } from '@/lib/types'
import { useModalFocus } from '@/lib/use-modal-focus'
import './photo-tools.css'

type Props = { eventName: string; onClose: () => void; guest?: boolean; initialEventId?: string; initialSessionId?: string }
const time = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export function GalleryPanel({ eventName, onClose, guest = false, initialEventId, initialSessionId }: Props) {
  const [eventId, setEventId] = useState(initialEventId ?? galleryEventId(eventName))
  const [events, setEvents] = useState<{ id: string; name: string }[]>([])
  const [entries, setEntries] = useState<GalleryEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [search, setSearch] = useState(initialSessionId?.split('-').at(-1) ?? '')
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<GalleryEntry | null>(null)
  const [variantId, setVariantId] = useState('')
  const [legacySize, setLegacySize] = useState<PrintSize | ''>('')
  const [copies, setCopies] = useState(1)
  const [printing, setPrinting] = useState(false)
  const printingRef = useRef(false)
  const [confirm, setConfirm] = useState(false)
  const [notice, setNotice] = useState('')
  const [imageFailed, setImageFailed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const generation = useRef(0)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  const close = useCallback(() => { if (!printingRef.current) onCloseRef.current() }, [])
  useModalFocus(root, close)

  useEffect(() => {
    if (guest) return
    let alive = true
    void fetch('/api/gallery?events=1').then(async response => {
      if (!response.ok) throw new Error('Gagal membaca daftar arsip')
      const data = await response.json()
      if (alive) setEvents(data.events)
    }).catch(error => { if (alive) setError(String(error)) })
    return () => { alive = false }
  }, [guest])

  useEffect(() => {
    generation.current++
    const controller = new AbortController()
    setLoading(true); setError(''); setCursor(null); setEntries([]); setSelected(null)
    const timer = setTimeout(() => {
      void fetch(`/api/gallery?event_id=${encodeURIComponent(eventId)}&seq=${encodeURIComponent(search)}`, { signal: controller.signal })
        .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data })
        .then(data => {
          if (controller.signal.aborted) return
          setEntries(data.entries); setCursor(data.next_cursor)
          if (initialSessionId) setSelected(data.entries.find((entry: GalleryEntry) => entry.session_id === initialSessionId) ?? null)
          if (data.skipped) setNotice(`${data.skipped} metadata tidak terbaca; hasil lain tetap tersedia.`)
        }).catch(error => { if (!controller.signal.aborted) setError(String(error)) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 200)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [eventId, search, refresh, initialSessionId])

  useEffect(() => {
    setVariantId(selected?.variants?.at(-1)?.id ?? '')
    setCopies(1); setConfirm(false); setNotice(''); setLegacySize(''); setImageFailed(false)
  }, [selected?.session_id])

  useEffect(() => {
    if (!guest) return
    let timer: ReturnType<typeof setTimeout>
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => { if (!printingRef.current) close(); else reset() }, 120_000) }
    reset()
    window.addEventListener('pointerdown', reset); window.addEventListener('keydown', reset)
    return () => { clearTimeout(timer); window.removeEventListener('pointerdown', reset); window.removeEventListener('keydown', reset) }
  }, [guest, close])

  const variant = selected?.variants?.find(v => v.id === variantId) ?? selected?.variants?.at(-1)
  const qr = selected ? entryQrUrl(selected) : null
  const preview = selected ? galleryImageUrl(eventId, variant?.master_file ?? selected.print_path) : ''

  const refreshDetail = useCallback(async (signal?: AbortSignal) => {
    if (!selected?.session_id) return
    const sessionId = selected.session_id
    const response = await fetch(`/api/gallery?event_id=${encodeURIComponent(eventId)}&seq=${encodeURIComponent(selected.seq)}`, { signal })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Gagal memperbarui foto')
    const updated = data.entries.find((entry: GalleryEntry) => entry.session_id === sessionId)
    if (updated && !signal?.aborted) setSelected(current => current?.session_id === sessionId ? updated : current)
  }, [selected?.session_id, selected?.seq, eventId])

  useEffect(() => {
    if (!selected || qr) return
    const controller = new AbortController()
    const timer = setInterval(() => { void refreshDetail(controller.signal).catch(error => { if (!controller.signal.aborted) setError(String(error)) }) }, 3000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [selected?.session_id, qr, refreshDetail])

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true); setError('')
    const requestGeneration = generation.current
    try {
      const response = await fetch(`/api/gallery?event_id=${encodeURIComponent(eventId)}&seq=${encodeURIComponent(search)}&cursor=${encodeURIComponent(cursor)}`)
      const data = await response.json()
      if (requestGeneration !== generation.current) return
      if (!response.ok) throw new Error(data.error)
      setEntries(old => [...old, ...data.entries.filter((entry: GalleryEntry) => !old.some(e => e.session_id === entry.session_id))]); setCursor(data.next_cursor)
    } catch (error) { if (requestGeneration === generation.current) setError(String(error)) }
    finally { if (requestGeneration === generation.current) setLoading(false) }
  }

  async function reprint() {
    if (!selected || printingRef.current || imageFailed) return
    const output: GalleryVariant | undefined = variant ?? (legacySize ? { id: 'legacy', label: 'Arsip', created_at: selected.created_at,
      master_file: selected.print_path, thumbnail_file: selected.thumb_path, width: 0, height: 0,
      print_size: legacySize, recipe: legacySize.startsWith('A') ? 'iso_page' : 'single_4r' } : undefined)
    if (!output) return
    printingRef.current = true; setPrinting(true); setConfirm(false); setNotice('')
    try {
      const result = await printGalleryVariant(eventId, output, copies)
      setNotice(result === 'printer' ? 'Dikirim ke printer.' : 'Dialog cetak dibuka.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Gagal mencetak') }
    finally { printingRef.current = false; setPrinting(false) }
  }

  return <div className="photo-dialog" role="dialog" aria-modal="true" aria-label="Browse foto dan cetak ulang" tabIndex={-1} ref={root}>
    <header className="photo-toolbar">
      <div><h2>Browse Foto</h2><p>{eventId} · {entries.length}{cursor ? '+' : ''} sesi</p></div>
      <button onClick={close} disabled={printing} aria-label="Tutup galeri">Tutup ✕</button>
    </header>
    <div className="photo-content">
      {!selected && <div className="photo-filters">
        {!guest && <label>Event / tanggal<select value={eventId} onChange={e => setEventId(e.target.value)}>
          {!events.some(e => e.id === eventId) && <option value={eventId}>{eventId}</option>}
          {events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}
        </select></label>}
        <label>Nomor sesi<input value={search} onChange={e => setSearch(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Cari, mis. 023" /></label>
        <button onClick={() => setRefresh(value => value + 1)} disabled={loading}>Refresh</button>
      </div>}
      {error && <p role="alert" className="photo-error">{error} <button onClick={() => setRefresh(v => v + 1)}>Coba lagi</button></p>}
      {notice && <p role="status" className="photo-notice">{notice}</p>}
      {loading && !entries.length && <p role="status">Memuat foto…</p>}
      {!loading && !error && !entries.length && <div className="photo-empty"><h3>Belum ada foto di event ini</h3><p>Hasil final dan foto Fast Mode akan muncul di sini.</p></div>}
      {selected ? <>
        <button onClick={() => { setSelected(null); setNotice('') }} disabled={printing}>← Kembali ke thumbnail</button>{' '}
        <button onClick={() => void refreshDetail().catch(error => setError(String(error)))} disabled={printing}>Refresh foto / QR</button>
        <div className="photo-detail">
          <div className="photo-preview">{imageFailed ? <p role="alert">File foto tidak tersedia. Hasil lain tetap dapat dibuka.</p> : <img key={preview} src={preview} alt={`Hasil final foto ${selected.seq}`} onError={() => setImageFailed(true)} />}</div>
          <div className="photo-detail-actions">
            <div><h3>Foto #{selected.seq}</h3><p>{time(selected.created_at)}</p>{selected.source_name && <p className="photo-filename">{selected.source_name}</p>}</div>
            {!!selected.variants?.length && <label>Hasil tersimpan<select disabled={printing} value={variant?.id ?? ''} onChange={e => { setVariantId(e.target.value); setImageFailed(false); setConfirm(false) }}>
              {selected.variants.map(v => <option key={v.id} value={v.id}>{v.label}{v.frame_id === null ? ' · tanpa frame' : ''}</option>)}
            </select></label>}
            {variant?.warning && <p className="photo-notice">{variant.warning}</p>}
            {qr ? <div className="photo-qr"><QRCodeSVG value={qr} size={180} /><p>Scan QR sesi ini</p></div> : <p className="photo-notice">QR belum tersedia. Foto lokal tetap bisa dicetak. Refresh galeri setelah upload selesai.</p>}
            {!variant && <label>Format arsip lama<select value={legacySize} onChange={e => setLegacySize(e.target.value as PrintSize)}>
              <option value="">Pilih ukuran sebelum cetak</option>{(['4R_PORTRAIT', '4R_LANDSCAPE', 'A4_PORTRAIT', 'A4_LANDSCAPE', 'A3_PORTRAIT', 'A3_LANDSCAPE'] as const).map(size => <option key={size}>{size}</option>)}
            </select></label>}
            <label>Jumlah salinan<input type="number" min={1} max={20} value={copies} disabled={printing} onChange={e => { setCopies(Math.min(20, Math.max(1, Number(e.target.value) || 1))); setConfirm(false) }} /></label>
            {confirm ? <div className="photo-confirm"><p>Cetak ulang foto #{selected.seq} · {variant?.print_size ?? legacySize} · {copies} salinan?</p>
              <button className="photo-primary" onClick={() => void reprint()}>Ya, cetak</button> <button onClick={() => setConfirm(false)}>Batal</button></div>
              : <button className="photo-primary" disabled={printing || imageFailed || (!variant && !legacySize)} onClick={() => setConfirm(true)}>{printing ? 'Mengirim…' : 'Cetak Ulang'}</button>}
          </div>
        </div>
      </> : <>
        <div className="photo-grid">{entries.map(entry => <button className="photo-card" key={entry.session_id} onClick={() => setSelected(entry)}>
          <img src={galleryImageUrl(eventId, entry.thumb_path)} alt={`Foto ${entry.seq}`} loading="lazy" />
          <span>#{entry.seq} · {time(entry.created_at)}</span><small>{entryQrUrl(entry) ? 'QR tersedia' : 'QR belum tersedia'}</small>
        </button>)}</div>
        {cursor && <button className="photo-load" disabled={loading} onClick={() => void loadMore()}>{loading ? 'Memuat…' : 'Muat Lagi'}</button>}
      </>}
    </div>
  </div>
}

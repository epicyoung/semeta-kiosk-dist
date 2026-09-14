'use client'
import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { TouchButton } from '@/components/ui/TouchButton'
import { printPhoto } from '@/lib/print'
import { entryQrUrl, type GalleryEntry } from '@/lib/gallery'

/**
 * Gallery cetak-ulang — dibuka operator dari Settings (bukan tamu).
 * Tamu balik ke booth minta dicetakin lagi buat temennya: operator buka,
 * pilih foto, tekan Cetak. Yang dicetak = file komposit yang UDAH JADI,
 * jadi hasilnya identik sama cetakan pertama.
 */

type Props = {
  eventName: string
  onClose: () => void
}

function imgSrc(eventName: string, absPath: string): string {
  // Route cuma nerima basename — pathnya sendiri dikurung ke folder event di server.
  const file = absPath.split(/[\\/]/).pop() ?? ''
  return `/api/gallery/image?event_name=${encodeURIComponent(eventName)}&file=${encodeURIComponent(file)}`
}

function jamWIB(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    })
  } catch { return '' }
}

export function GalleryPanel({ eventName, onClose }: Props) {
  const [entries, setEntries] = useState<GalleryEntry[] | null>(null)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<GalleryEntry | null>(null)
  const [printing, setPrinting] = useState(false)
  const [printErr, setPrintErr] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/gallery?event_name=${encodeURIComponent(eventName)}`)
      .then(r => r.json())
      .then(d => { if (alive) setEntries(Array.isArray(d.entries) ? d.entries : []) })
      .catch(() => { if (alive) { setError(true); setEntries([]) } })
    return () => { alive = false }
  }, [eventName])

  async function handleReprint(entry: GalleryEntry) {
    if (printing) return
    setPrinting(true)
    setPrintErr(false)
    try {
      // Jalur print yang sama persis dgn cetakan pertama — file udah final, ga
      // dikomposit ulang, jadi hasilnya ga mungkin beda.
      await printPhoto(imgSrc(eventName, entry.print_path), 1)
    } catch (err) {
      console.error('[gallery] cetak ulang gagal:', err)
      setPrintErr(true)
    } finally {
      setPrinting(false)
    }
  }

  const qr = selected ? entryQrUrl(selected) : null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(9,1,53,0.97)',
      backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 500, color: '#fff', margin: 0 }}>
            Galeri — Cetak Ulang
          </h2>
          <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.4)', margin: '3px 0 0' }}>
            {eventName}{entries ? ` · ${entries.length} foto` : ''}
          </p>
        </div>
        <button
          onClick={selected ? () => setSelected(null) : onClose}
          aria-label={selected ? 'Kembali ke grid' : 'Tutup galeri'}
          style={{
            background: 'rgba(255,255,255,0.08)', border: 'none', color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer', fontSize: 'var(--text-lg)', lineHeight: 1,
            padding: '6px 12px', borderRadius: 'var(--radius-glass)',
          }}
        >{selected ? '←' : '✕'}</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {entries === null && (
          <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', marginTop: 40 }}>Memuat…</p>
        )}

        {entries?.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 48, color: 'rgba(255,255,255,0.4)' }}>
            <p style={{ fontSize: 'var(--text-base)' }}>
              {error ? 'Gagal membaca galeri.' : 'Belum ada foto di event ini.'}
            </p>
            <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.25)', marginTop: 8 }}>
              Foto muncul di sini setelah tamu mencetak.
            </p>
          </div>
        )}

        {/* Detail */}
        {selected && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'center', alignItems: 'flex-start' }}>
            <img
              src={imgSrc(eventName, selected.print_path)}
              alt={`Foto ${selected.seq}`}
              style={{ maxWidth: 'min(420px, 60vw)', maxHeight: '60vh', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 200 }}>
              <div>
                <p style={{ fontSize: 'var(--text-2xs)', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', margin: 0 }}>
                  Foto #{selected.seq}
                </p>
                <p style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.5)', margin: '4px 0 0' }}>
                  {jamWIB(selected.created_at)} WIB
                </p>
              </div>

              {/* QR cuma kalau udah ke-upload. Kalau belum: bilang terus terang,
                  jangan kasih QR yang nuntun tamu ke 404. */}
              {qr ? (
                <div style={{ background: '#fff', padding: 10, borderRadius: 10, width: 'fit-content' }}>
                  <QRCodeSVG value={qr} size={132} />
                </div>
              ) : (
                <div style={{
                  padding: '14px 16px', borderRadius: 10, border: '1px dashed rgba(255,255,255,0.18)',
                  color: 'rgba(255,255,255,0.45)', fontSize: 'var(--text-xs)', maxWidth: 200,
                }}>
                  Belum terunggah — QR belum tersedia. Cetak tetap bisa.
                </div>
              )}

              <TouchButton onClick={() => handleReprint(selected)} disabled={printing}>
                {printing ? 'Menyiapkan…' : '🖨 Cetak Ulang'}
              </TouchButton>
              {printErr && (
                <p style={{ fontSize: 'var(--text-2xs)', color: '#fca5a5', margin: 0 }}>
                  Cetak gagal dibuka. Coba lagi.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Grid */}
        {!selected && entries && entries.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 14,
          }}>
            {entries.map(e => (
              <button
                key={e.seq}
                onClick={() => { setSelected(e); setPrintErr(false) }}
                style={{
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
                  borderRadius: 12, overflow: 'hidden', cursor: 'pointer', padding: 0,
                  display: 'flex', flexDirection: 'column',
                }}
              >
                <img
                  src={imgSrc(eventName, e.thumb_path)}
                  alt={`Foto ${e.seq}`}
                  loading="lazy"
                  style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', display: 'block' }}
                />
                <span style={{
                  fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.45)',
                  padding: '7px 0', letterSpacing: '0.08em',
                }}>
                  #{e.seq} · {jamWIB(e.created_at)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

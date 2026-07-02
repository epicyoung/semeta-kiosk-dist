'use client'
// Dev-only sanity check for the unlicensed watermark burn. Pick an image → see clean vs
// burned side-by-side → "Test Print" sends the BURNED dataURL through the real print path
// so you can verify the PAPER matches the screen (catches the two-canvas bug).
import { useState } from 'react'
import { burnWatermark } from '@/lib/watermark-canvas'
import { printPhoto } from '@/lib/print'

const SAMPLE = '/photo-1488426862026-3ee34a7d66df.jpg'

export default function WmTestPage() {
  const [src, setSrc] = useState<string>(SAMPLE)
  const [burned, setBurned] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(dataUrl: string) {
    setBusy(true)
    setSrc(dataUrl)
    setBurned(await burnWatermark(dataUrl))
    setBusy(false)
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => run(reader.result as string)
    reader.readAsDataURL(file)
  }

  return (
    <main style={{ minHeight: '100vh', background: '#0b0b0f', color: '#fff', padding: 32, fontFamily: 'var(--font-ui)' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Watermark burn test</h1>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 24 }}>
        Kiri = asli (licensed). Kanan = hasil <code>burnWatermark</code> (unlicensed). “Test Print”
        cetak versi kanan lewat jalur print asli — cek kertasnya sama kayak layar.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <label style={btn}>
          Pilih gambar…
          <input type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
        </label>
        <button style={btn} onClick={() => run(SAMPLE)} disabled={busy}>Pakai sample</button>
        <button
          style={{ ...btn, opacity: burned ? 1 : 0.4, cursor: burned ? 'pointer' : 'default' }}
          onClick={() => burned && printPhoto(burned, 1)}
          disabled={!burned}
        >
          🖨️ Test Print (burned)
        </button>
        <button
          style={{ ...btn, background: 'rgba(255,255,255,0.08)' }}
          onClick={() => src && printPhoto(src, 1)}
        >
          Test Print (clean — buat banding)
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <figure style={{ margin: 0 }}>
          <figcaption style={cap}>Licensed — bersih</figcaption>
          <img src={src} alt="clean" style={img} />
        </figure>
        <figure style={{ margin: 0 }}>
          <figcaption style={cap}>Unlicensed — burned {busy && '(rendering…)'}</figcaption>
          {burned
            ? <img src={burned} alt="burned" style={img} />
            : <div style={{ ...img, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.4)' }}>—</div>}
        </figure>
      </div>
    </main>
  )
}

const btn: React.CSSProperties = {
  padding: '10px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)',
  background: '#7c3aed', color: '#fff', fontSize: 14, cursor: 'pointer',
}
const cap: React.CSSProperties = {
  fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.5)', marginBottom: 8,
}
const img: React.CSSProperties = {
  width: '100%', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
  background: '#000', aspectRatio: '4/6', objectFit: 'cover',
}

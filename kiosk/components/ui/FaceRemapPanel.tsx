'use client'
import { useEffect, useState } from 'react'
import { TouchButton } from '@/components/ui/TouchButton'
import { detectUserFaces } from '@/lib/facedetect'
import { initialMapping } from '@/lib/refine-result'
import { useT } from '@/lib/i18n'
import type { Face } from '@/lib/types'

type Props = {
  /** Foto hasil AI yang mau ditimpa mukanya — sumber muka TUJUAN. */
  aiUrl: string
  /** Foto asli tamu — sumber muka ASAL. */
  selfieUrl: string
  onCancel: () => void
  onConfirm: (mapping: (number | null)[]) => void
}

/** Petakan muka di hasil AI → muka tamu, sebelum swap ulang.
 *
 *  BEDA sama FaceAssignScreen: yang itu muka-tamu → slot-template (bentuknya slot-based,
 *  butuh template.thumbnail_url). Di sini ga ada template sama sekali — dua-duanya foto
 *  jadi, dan yang dipetakan muka-ke-muka. Makanya komponen sendiri, bukan reuse.
 *
 *  Deteksi jalan pas panel kebuka. Nol muka AI ⇒ parent yang matiin tombol duluan, tapi
 *  tetep dijaga di sini kalau deteksinya beda hasil antara pas ngecek dan pas buka. */
export function FaceRemapPanel({ aiUrl, selfieUrl, onCancel, onConfirm }: Props) {
  const t = useT()
  const [aiFaces, setAiFaces] = useState<Face[]>([])
  const [selfieFaces, setSelfieFaces] = useState<Face[]>([])
  const [mapping, setMapping] = useState<(number | null)[]>([])
  const [detecting, setDetecting] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [ai, selfie] = await Promise.all([detectUserFaces(aiUrl), detectUserFaces(selfieUrl)])
        if (!alive) return
        setAiFaces(ai)
        setSelfieFaces(selfie)
        setMapping(initialMapping(ai.length, selfie.length))
        setFailed(ai.length === 0 || selfie.length === 0)
      } catch {
        if (alive) setFailed(true)
      } finally {
        if (alive) setDetecting(false)
      }
    })()
    return () => { alive = false }
  }, [aiUrl, selfieUrl])

  // Klik muka tamu → pasangin ke slot AI yang lagi aktif. Klik lagi yang sama = lepas
  // (null = muka itu dibiarin hasil AI, ga di-swap).
  const assign = (aiIndex: number, selfieIndex: number) => {
    setMapping(m => m.map((v, i) => (i === aiIndex ? (v === selfieIndex ? null : selfieIndex) : v)))
  }

  const body = () => {
    if (detecting) return <p style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>{t('remap_detecting') as string}</p>
    if (failed) return <p style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>{t('remap_no_face') as string}</p>
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {aiFaces.map((af, i) => (
          <div key={af.id}>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>
              {(t('remap_person') as string).replace('{n}', String(i + 1))}
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <img src={af.cropUrl ?? aiUrl} alt="" style={{ width: 72, height: 72, borderRadius: 12, objectFit: 'cover', opacity: 0.6 }} />
              <span style={{ color: 'var(--fg-muted)' }}>←</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {selfieFaces.map((sf, j) => (
                  <button
                    key={sf.id}
                    onClick={() => assign(i, j)}
                    className="active:scale-[0.97] transition-all"
                    style={{
                      width: 72, height: 72, borderRadius: 12, overflow: 'hidden', padding: 0,
                      border: mapping[i] === j ? '3px solid var(--brand)' : '3px solid rgba(255,255,255,0.12)',
                    }}
                  >
                    <img src={sf.cropUrl ?? selfieUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className="animate-fade-in"
      style={{ position: 'absolute', inset: 0, zIndex: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(9,1,53,0.72)', backdropFilter: 'blur(8px)' }}
      onClick={onCancel}
    >
      <div
        className="animate-fade-in"
        onClick={e => e.stopPropagation()}
        style={{ background: 'rgba(20,10,70,0.95)', border: '1px solid var(--border-dialog)', borderRadius: 'var(--radius-dialog)', padding: 32, width: '90%', maxWidth: 460, maxHeight: '80%', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}
      >
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', marginBottom: 20, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'center' }}>
          {t('remap_title') as string}
        </p>
        {body()}
        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
          <TouchButton variant="secondary" onClick={onCancel} className="flex-1">
            {t('remap_cancel') as string}
          </TouchButton>
          <TouchButton onClick={() => onConfirm(mapping)} disabled={detecting || failed} className="flex-1">
            {t('remap_confirm') as string}
          </TouchButton>
        </div>
      </div>
    </div>
  )
}

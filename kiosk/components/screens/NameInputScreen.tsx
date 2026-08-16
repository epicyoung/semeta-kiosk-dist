'use client'
import { useEffect, useRef, useState, type Dispatch } from 'react'
import { TouchButton } from '@/components/ui/TouchButton'
import type { KioskAction, Template } from '@/lib/types'
import { useT } from '@/lib/i18n'
import { sanitizeInput, INPUT_MAX_LEN } from '@/lib/prompt-input'

type Props = {
  template: Template
  dispatch: Dispatch<KioskAction>
}

// Teks yang tamu ketik di sini nempel di prompt BERBAYAR dan DIRENDER jadi teks di dalam
// gambar yang bakal dicetak. Booth pakai keyboard fisik, jadi ga ada pembatasan dari
// perangkat — sanitizeInput dipanggil di TIAP ketikan (bukan cuma pas submit) supaya
// tamu LIHAT hasil yang sebenernya masuk prompt, bukan kaget pas hasilnya keluar.
export function NameInputScreen({ template, dispatch }: Props) {
  const t = useT()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Nama OPSIONAL. Kosong = {input} dibuang beserta spasi di depannya, jadi papan namanya
  // cuma "TOSARI" — referensi halte tetep kebakar seperti biasa.
  const submit = () => dispatch({ type: 'START_PROCESSING', userInput: value })

  return (
    <div className="screen-split flex flex-col w-full h-full overflow-hidden">
      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1 className="h1-glow" style={{ fontSize: 'clamp(32px,5vw,48px)', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>
          {template.input_label}
        </h1>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 300, color: 'var(--fg-muted)', lineHeight: 1.618, textWrap: 'balance' }}>
          {t('nameinput_subtitle') as string}
        </p>
      </div>

      <div className="screen-content flex items-center justify-center px-5">
        <div style={{ width: 560, maxWidth: '100%' }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 18, padding: '0 22px',
            }}
          >
            <input
              ref={inputRef}
              value={value}
              onChange={e => setValue(sanitizeInput(e.target.value))}
              onKeyDown={e => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') dispatch({ type: 'BACK' })
              }}
              placeholder={t('nameinput_placeholder') as string}
              aria-label={template.input_label ?? undefined}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                color: '#fff', caretColor: 'white', padding: '22px 0',
                fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-ui)',
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}
            />
            <span style={{ flexShrink: 0, fontSize: 'var(--text-sm)', color: 'var(--fg-subtle)', fontVariantNumeric: 'tabular-nums' }}>
              {value.length}/{INPUT_MAX_LEN}
            </span>
          </div>
          {/* Tamu harus tau namanya bakal KELIHATAN di cetakan — bukan cuma metadata. */}
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)', margin: '14px 4px 0', textWrap: 'balance' }}>
            {t('nameinput_hint') as string}
          </p>
        </div>
      </div>

      <div className="screen-actions shrink-0 p-5 flex flex-row gap-4">
        <TouchButton variant="ghost" className="flex-1" onClick={() => dispatch({ type: 'BACK' })}>
          {t('nameinput_back') as string}
        </TouchButton>
        {/* Ga pernah disabled: kosong itu pilihan sah, bukan error. Label ganti jadi "Lewati"
            biar tamu tau dia boleh jalan tanpa ngetik — tombol aktif tapi tanpa petunjuk
            bikin orang berdiri nunggu ngira ada yang kurang. */}
        <TouchButton className="flex-1" onClick={submit}>
          {(value ? t('nameinput_next') : t('nameinput_skip')) as string}
        </TouchButton>
      </div>
    </div>
  )
}

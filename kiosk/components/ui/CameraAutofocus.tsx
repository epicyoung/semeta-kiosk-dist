'use client'
import { useT } from '@/lib/i18n'

// ponytail: MATI sampai ada tes hardware Canon + dCC. Tap cuma micu AF point yang lagi
// aktif di kamera — BELUM mindahin titik fokus ke lokasi sentuh, jadi ditahan dulu biar
// tamu ga salah sangka. Nyalain = true. Kode + test sengaja dibiarin utuh.
export const AUTOFOCUS_ENABLED = false

type Props = { disabled: boolean; focusing: boolean; message: string; onFocus: () => Promise<void> }

// No target reticle: this triggers the camera's existing AF point, not tap coordinates.
export function CameraAutofocus({ disabled, focusing, message, onFocus }: Props) {
  const t = useT()
  return <>
    <button type="button" aria-label={t('liveview_autofocus_aria') as string} disabled={disabled || focusing}
      onClick={() => { void onFocus() }}
      style={{ position: 'absolute', inset: 0, zIndex: 21, border: 0, background: 'transparent', cursor: disabled || focusing ? 'default' : 'crosshair', touchAction: 'manipulation' }} />
    <div role="status" aria-live="polite" style={{ position: 'absolute', left: 12, top: 12, right: 72, zIndex: 22, pointerEvents: 'none', borderRadius: 8, padding: '8px 10px', background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 12 }}>
      {message || t('liveview_autofocus_hint') as string}
    </div>
  </>
}

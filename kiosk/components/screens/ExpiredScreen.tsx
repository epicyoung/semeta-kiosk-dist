'use client'
import { useT } from '@/lib/i18n'

export function ExpiredScreen() {
  const t = useT()
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 100,
      background: 'rgba(9,1,53,0.97)', backdropFilter: 'blur(32px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: 40, textAlign: 'center',
    }}>
      <div style={{ fontSize: 'var(--text-3xl)', marginBottom: 8 }}>⏰</div>
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: '#fff', margin: 0, letterSpacing: '-0.03em' }}>
        {t('expired_title') as string}
      </h1>
      <p style={{ fontSize: 'var(--text-base)', color: 'rgba(255,255,255,0.6)', margin: 0, maxWidth: 360 }}>
        {t('expired_subtitle') as string}
      </p>
      <p style={{ fontSize: 'var(--text-base)', color: 'var(--fg-subtle)', margin: 0 }}>
        {t('expired_contact') as string}
      </p>
      <a
        href="https://wa.me/6281234567890"
        style={{
          fontSize: 'var(--text-base)', fontWeight: 600, color: '#a3e635',
          textDecoration: 'none', padding: '12px 28px', borderRadius: 12,
          border: '1px solid rgba(163,230,53,0.35)', background: 'rgba(163,230,53,0.08)',
          marginTop: 8,
        }}
      >
        wa.me/6281234567890
      </a>
    </div>
  )
}

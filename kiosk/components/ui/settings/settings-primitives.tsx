import type { Translations } from '@/lib/locales/types'

export type TFn = (key: keyof Translations) => Translations[keyof Translations]

export type PbStatus = 'idle' | 'checking' | 'connected' | 'offline'

// ── Accordion group ──────────────────────────────────────────────────────────
export function AccordionGroup({
  id, icon, title, open, onToggle, children,
}: {
  id: string; icon: string; title: string; open: boolean; onToggle: (id: string) => void; children: React.ReactNode
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => onToggle(id)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '15px 0', background: 'none', border: 'none',
          borderBottom: open ? '1px solid rgba(124,58,237,0.35)' : '1px solid rgba(255,255,255,0.08)',
          cursor: 'pointer', color: '#fff', textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, letterSpacing: '0.01em', color: open ? '#a78bfa' : '#fff' }}>{title}</span>
        </span>
        <span style={{
          fontSize: 11, color: 'rgba(255,255,255,0.35)',
          display: 'inline-block', transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▾</span>
      </button>
      {open && <div style={{ paddingTop: 4 }}>{children}</div>}
    </div>
  )
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{label}</span>
      {children}
    </div>
  )
}

// Row + footnote awam di bawah label — buat setting teknis (CFG/steps/ControlNet strength)
// yang namanya sendiri gak cukup jelas buat operator non-teknis.
export function RowHint({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 16 }}>
      {/* maxWidth biar hint wrap sebelum nyentuh kontrol di kanan — teksnya utuh,
          cuma pecah barisnya lebih awal. Tanpa ini dia manjang sampe mepet dropdown. */}
      <div style={{ minWidth: 0, maxWidth: '58%' }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>{label}</span>
        <p style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0', lineHeight: 1.4 }}>{hint}</p>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

export function Toggle({ on, onToggle, disabled = false }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={disabled ? undefined : onToggle} disabled={disabled} style={{ background: 'none', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', padding: 0, opacity: disabled ? 0.4 : 1 }}>
      <div style={{ width: 44, height: 24, borderRadius: 12, background: on ? 'var(--brand)' : 'rgba(255,255,255,0.15)', position: 'relative', transition: 'background 0.2s' }}>
        <div style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
      </div>
    </button>
  )
}

export function Sel({ value, options, onChange }: { value: string; options: { value: string; label: string; soon?: boolean }[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 'var(--radius-glass)', color: '#fff', fontSize: 'var(--text-sm)', padding: '6px 10px',
      fontFamily: 'var(--font-ui)', cursor: 'pointer', outline: 'none', maxWidth: 220,
    }}>
      {options.map(o => <option key={o.value} value={o.value} disabled={o.soon} style={{ background: 'var(--bg)', color: o.soon ? 'rgba(255,255,255,0.3)' : '#fff' }}>{o.label}</option>)}
    </select>
  )
}

export function TextInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.13)',
        borderRadius: 'var(--radius-glass)', color: '#fff', fontSize: mono ? 'var(--text-xs)' : 'var(--text-sm)', padding: '7px 12px',
        fontFamily: 'var(--font-ui)',
        // maxWidth, BUKAN width tetap — samain sama Sel biar input & dropdown
        // sejajar lebarnya. width:220 dulu bikin input selalu penuh walau isinya pendek.
        outline: 'none', width: '100%', maxWidth: 220, boxSizing: 'border-box', textAlign: 'right',
      }}
    />
  )
}

export function StatusBadge({ status, t }: { status: PbStatus; t: TFn }) {
  const map: Record<PbStatus, { dot: string; label: string }> = {
    idle:      { dot: 'rgba(255,255,255,0.2)', label: '—' },
    checking:  { dot: '#f0c040',               label: t('set_badge_checking') as string },
    connected: { dot: '#a3be8c',               label: t('set_badge_connected') as string },
    offline:   { dot: '#ff6b6b',               label: t('set_badge_offline') as string },
  }
  const { dot, label } = map[status]
  return (
    <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-ui)', color: dot }}>{label}</span>
  )
}

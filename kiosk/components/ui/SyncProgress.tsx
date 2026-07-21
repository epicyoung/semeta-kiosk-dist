'use client'
import { TouchButton } from './TouchButton'

// Hasil akhir dari /api/sync-templates (shape sama seperti SettingsPanel & GlassShell konsumsi).
export type SyncResult = {
  added: number
  cropped: number
  deleted: number
  detectDown: boolean
  skipped: { name: string; reason: string }[]
  loaded: number // jumlah template yang akhirnya kebaca dari PB setelah sync
}

export type SyncPhase =
  | { kind: 'syncing'; message?: string; current?: number; total?: number; name?: string }
  | { kind: 'done'; result: SyncResult }
  | { kind: 'error'; message: string }

type Props = {
  phase: SyncPhase | null
  onClose: () => void
}

const overlay: React.CSSProperties = {
  position: 'absolute', inset: 0, zIndex: 60,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(9,1,53,0.55)', backdropFilter: 'blur(6px)',
}

const card: React.CSSProperties = {
  width: 'min(460px, 88%)', maxHeight: '80%', overflow: 'hidden',
  display: 'flex', flexDirection: 'column',
  borderRadius: 'var(--radius-glass)',
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.08)',
  boxShadow: '0 20px 60px rgba(0,0,0,0.45), inset 1px 1px 0 rgba(255,255,255,0.25)',
  padding: 24,
}

const row = (label: string, value: number | string, accent?: string) => (
  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)', letterSpacing: '0.03em' }}>{label}</span>
    <span style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: accent ?? '#fff' }}>{value}</span>
  </div>
)

export function SyncProgress({ phase, onClose }: Props) {
  if (!phase) return null

  return (
    <div style={overlay} onClick={phase.kind !== 'syncing' ? onClose : undefined}>
      <div style={card} onClick={e => e.stopPropagation()}>
        {phase.kind === 'syncing' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ display: 'inline-block', fontSize: 40, animation: 'sync-spin 0.9s linear infinite', marginBottom: 16 }}>↻</div>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 8 }}>
              {phase.total && phase.current ? `Menyinkronkan (${phase.current}/${phase.total})` : 'Menyinkronkan template…'}
            </h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)', lineHeight: 1.5, minHeight: 42 }}>
              {phase.name ? <span style={{ color: '#fff' }}>{phase.name}</span> : (phase.message || 'Membaca folder, crop 2:3, tulis ke database.')}<br />
              Jangan tutup jendela ini.
            </p>
            {phase.total && phase.current && (
              <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 16, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(phase.current / phase.total) * 100}%`, background: '#a78bfa', transition: 'width 0.2s' }} />
              </div>
            )}
          </div>
        )}

        {phase.kind === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12, color: '#ff6b6b' }}>⚠</div>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 8 }}>Sync gagal</h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)', lineHeight: 1.5, marginBottom: 20 }}>
              {phase.message}
            </p>
            <TouchButton onClick={onClose} className="w-full">Tutup</TouchButton>
          </div>
        )}

        {phase.kind === 'done' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 36, marginBottom: 8, color: '#a3be8c' }}>✓</div>
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 500 }}>Sync selesai</h2>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)', marginTop: 4 }}>
                {phase.result.loaded} template siap dipakai
              </p>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {row('Template baru masuk', phase.result.added, phase.result.added ? '#a3be8c' : undefined)}
              {row('Di-crop ke 2:3', phase.result.cropped)}
              {row('Dihapus (tak ada di folder)', phase.result.deleted, phase.result.deleted ? '#e5c07b' : undefined)}
              {row('Di-skip', phase.result.skipped.length, phase.result.skipped.length ? '#ff6b6b' : undefined)}

              {phase.result.detectDown && (
                <p style={{ fontSize: 'var(--text-2xs)', color: '#e5c07b', marginTop: 10, lineHeight: 1.5 }}>
                  ⓘ face_server mati — crop pakai posisi tengah (bukan face-aware).
                </p>
              )}

              {phase.result.skipped.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--fg-muted)', marginBottom: 6 }}>
                    File di-skip
                  </p>
                  {phase.result.skipped.map((s, i) => (
                    <p key={i} style={{ fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>
                      <span style={{ color: '#fff' }}>{s.name}</span> — {s.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <TouchButton onClick={onClose} className="w-full">Tutup</TouchButton>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

import type { CameraStatus } from '@/lib/dcc-controller'

export function CameraIndicator({ status }: { status: CameraStatus }) {
  const color = status.phase === 'live' ? '#86efac' : status.phase === 'error' ? '#fca5a5' : '#fde68a'
  return <div role="status" aria-live="polite" style={{ position: 'absolute', left: 12, bottom: 12, right: 64, zIndex: 35, pointerEvents: 'none', color, background: 'rgba(0,0,0,.8)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
    <span aria-hidden="true">● </span>{status.message}
  </div>
}

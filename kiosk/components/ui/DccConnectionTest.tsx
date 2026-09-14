'use client'
import { useEffect, useState } from 'react'
import { useCanonLive } from '@/lib/use-canon-live'

export function DccConnectionTest({ exe }: { exe: string }) {
  const [testing, setTesting] = useState(false)
  const [testPath, setTestPath] = useState('')
  const camera = useCanonLive(testing, false, testPath)
  useEffect(() => {
    if (!testing) return
    const timer = setTimeout(() => setTesting(false), 60_000)
    return () => clearTimeout(timer)
  }, [testing])
  return <div style={{ padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
    {/* Gaya samain sama tombol sekunder lain di panel ini (Check for updates). */}
    <button
      type="button"
      onClick={() => {
        if (testing) setTesting(false)
        else { setTestPath(exe.trim()); camera.reset(); setTesting(true) }
      }}
      style={{
        padding: '6px 16px', borderRadius: 'var(--radius-glass)', border: '1px solid rgba(255,255,255,0.15)',
        background: testing ? 'rgba(240,192,64,0.15)' : 'rgba(255,255,255,0.07)',
        color: testing ? '#f0c040' : 'rgba(255,255,255,0.8)',
        fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)', cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >{testing ? 'Hentikan tes' : 'Tes koneksi DCC'}</button>
    {testing && <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
      <p role="status" style={{ margin: 0, color: camera.ready ? '#86efac' : '#fde68a', fontSize: 'var(--text-xs)' }}>{camera.status.message}</p>
      {camera.src && <img src={camera.src} alt="Tes live view kamera" style={{ width: 240, maxWidth: '100%', borderRadius: 'var(--radius-glass)', display: 'block' }} />}
      <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.3)', lineHeight: 1.4 }}>Tes berhenti otomatis setelah 60 detik. Simpan Settings untuk memakai lokasi ini pada sesi berikutnya.</p>
    </div>}
  </div>
}

import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'
import { reasonForStatus } from '@/lib/license'

export async function POST(req: NextRequest) {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
  const secret = localDb.getSecret()
  if (!workerUrl || !secret)
    return NextResponse.json({ status: 'bypassed', licensed: true, remaining_sec: 0 })

  try {
    const body = await req.json().catch(() => ({}))
    // machine_id di-inject SERVER-SIDE (browser ga usah tau). Worker TOFU: simpan first-contact,
    // mismatch = soft log + lanjut (per-session by design). Tanpa ini machineId="" → lock ga trip.
    const withMachine = { ...body, machine_id: localDb.getMachineId() }
    const res = await fetch(`${workerUrl}/api/kiosk-handshake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(withMachine),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    // Worker MENJAWAB non-200 = verdict lisensi.
    // 404 = no active session → freeware (jalan + watermark, bukan lock).
    // 401/402/403 = invalid secret / expired / disabled → tetap lock.
    if (!res.ok) {
      if (res.status === 404) {
        // Freeware: teruskan force_lock supaya admin bisa takeover kiosk tanpa sewa aktif.
        const fw = await res.json().catch(() => ({} as Record<string, unknown>))
        return NextResponse.json({
          remaining_sec: 0, licensed: false, freeware: true,
          force_locked: fw.force_locked === true,
          lock_message: fw.lock_message ?? null,
        })
      }
      return NextResponse.json({ reason: reasonForStatus(res.status) }, { status: res.status })
    }
    const data = await res.json()
    // Handshake sukses → simpan lisensi lokal (seed countdown offline + dasar grace 12 jam).
    if (data.status !== 'bypassed' && !data.bypassed && typeof data.remaining_sec === 'number') {
      localDb.saveLicense({
        session_id: data.session_id ?? '',
        remaining_sec: data.remaining_sec,
        lastOkAt: Date.now(),
      })
    }
    return NextResponse.json(data)
  } catch {
    // Network error/timeout = offline (bukan verdict). Client putuskan grace vs lock.
    return NextResponse.json({ error: 'unreachable' }, { status: 503 })
  }
}

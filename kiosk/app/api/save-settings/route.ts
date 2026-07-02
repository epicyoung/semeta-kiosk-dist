import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'

export async function POST(req: NextRequest) {
  const body = await req.json()

  // Persist folder path separately (survives data dir changes)
  if (body.template_local) localDb.setTemplateLocal(body.template_local)

  // Persist locally (merge with existing)
  const { template_local: _, ...rest } = body
  localDb.saveSettings({ ...localDb.getSettings(), ...rest })

  // Best-effort sync to worker
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
  const secret = localDb.getSecret()
  if (workerUrl && secret) {
    fetch(`${workerUrl}/api/kiosk-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}

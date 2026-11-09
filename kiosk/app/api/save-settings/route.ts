import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { localDb } from '@/lib/local-db'
import { assertLocalMutation } from '@/lib/local-request'
import { requireOperator } from '@/lib/operator-auth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    assertLocalMutation(req)
    requireOperator(req)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ditolak' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 })
  }

  // Persist folder path separately (survives data dir changes). Operator-only route,
  // tapi tetap validasi: path absolut, bukan drive root, tanpa traversal/null byte.
  if (body.template_local !== undefined) {
    const raw = body.template_local
    if (typeof raw !== 'string' || !raw.trim() || raw.includes('\0') || raw.split(/[\\/]/).includes('..')) {
      return NextResponse.json({ error: 'template_local tidak valid' }, { status: 400 })
    }
    const resolved = path.resolve(raw)
    if (!path.isAbsolute(raw) || path.parse(resolved).root === resolved) {
      return NextResponse.json({ error: 'template_local harus folder, bukan root drive' }, { status: 400 })
    }
    localDb.setTemplateLocal(resolved)
  }

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
      body: JSON.stringify(rest),
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}

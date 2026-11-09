import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'
import { assertLocalMutation } from '@/lib/local-request'

// Proxy ke Worker /api/generate-video — secret nempel di sini, gak pernah ke browser.
// Sama persis pola /api/generate; bedanya cuma path Worker.
export async function POST(req: NextRequest) {
  try { assertLocalMutation(req) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Ditolak' }, { status: 403 }) }
  const body = await req.json()
  const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/api/generate-video`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localDb.getSecret()}`,
    },
    body: JSON.stringify(body),
  })
  let data: unknown
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    data = await res.json()
  } else {
    const text = await res.text()
    data = { error: text || `Worker error ${res.status}` }
  }
  return NextResponse.json(data, { status: res.status })
}

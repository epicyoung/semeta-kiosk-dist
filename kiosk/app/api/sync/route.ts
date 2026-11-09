import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'
import { assertLocalMutation } from '@/lib/local-request'
import { requireOperator } from '@/lib/operator-auth'
import { assertPublicHttpUrlResolved } from '@/lib/outbound-url'
import type { Template } from '@/lib/types'

export const runtime = 'nodejs'

// Operator-only: sumber URL SELALU dari config admin (env), bukan body caller.
// Dulu body.admin_url menang → siapa pun bisa arahkan kiosk ke server sendiri
// (SSRF + ganti templates/settings). Sekarang body.admin_url diabaikan.
export async function POST(req: NextRequest) {
  try {
    assertLocalMutation(req)
    requireOperator(req)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ditolak' }, { status: 403 })
  }
  const url = process.env.ADMIN_CMS_URL || ''
  if (!url) return NextResponse.json({ error: 'ADMIN_CMS_URL belum diset' }, { status: 400 })

  let res: Response
  try {
    const target = await assertPublicHttpUrlResolved(`${url.replace(/\/+$/, '')}/api/sync-templates`)
    res = await fetch(target, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) })
  } catch (e: unknown) {
    return NextResponse.json({ error: `Cannot reach admin: ${(e as Error).message}` }, { status: 502 })
  }
  if (!res.ok) return NextResponse.json({ error: `Admin returned ${res.status}` }, { status: 502 })

  const { templates, settings } = await res.json()
  if (!Array.isArray(templates)) return NextResponse.json({ error: 'Payload admin tidak valid' }, { status: 502 })
  localDb.saveTemplates(templates as Template[])
  // Merge, jangan overwrite �?" key lokal yang gak dikirim admin (comfy_*, dll) harus selamat
  if (settings && typeof settings === 'object') localDb.saveSettings({ ...localDb.getSettings(), ...settings })

  return NextResponse.json({ ok: true, count: (templates as Template[]).length })
}

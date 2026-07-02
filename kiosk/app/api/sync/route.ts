import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'
import type { Template } from '@/lib/types'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const url: string = body.admin_url || process.env.ADMIN_CMS_URL || ''
  if (!url) return NextResponse.json({ error: 'admin_url required' }, { status: 400 })

  let res: Response
  try {
    res = await fetch(`${url}/api/sync-templates`, { cache: 'no-store' })
  } catch (e: unknown) {
    return NextResponse.json({ error: `Cannot reach admin: ${(e as Error).message}` }, { status: 502 })
  }
  if (!res.ok) return NextResponse.json({ error: `Admin returned ${res.status}` }, { status: 502 })

  const { templates, settings } = await res.json()
  localDb.saveTemplates(templates as Template[])
  if (settings) localDb.saveSettings(settings)

  return NextResponse.json({ ok: true, count: (templates as Template[]).length })
}

import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'

export async function POST(req: NextRequest) {
  try {
    const templates = await req.json()
    if (!Array.isArray(templates)) {
      return NextResponse.json({ ok: false, error: 'Expected array of templates' }, { status: 400 })
    }
    localDb.saveTemplates(templates)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

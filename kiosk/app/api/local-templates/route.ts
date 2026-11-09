import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'
import { assertLocalRead } from '@/lib/local-request'

export async function GET(req: NextRequest) {
  try {
    assertLocalRead(req)
    const templates = localDb.getTemplates()
    return NextResponse.json({ templates })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to read templates' }, { status: 500 })
  }
}

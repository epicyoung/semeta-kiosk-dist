import { NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'

export async function GET() {
  try {
    const templates = localDb.getTemplates()
    return NextResponse.json({ templates })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to read templates' }, { status: 500 })
  }
}

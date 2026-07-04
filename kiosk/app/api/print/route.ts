import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// pdf-to-printer (SumatraPDF) belum tersedia. printPhoto() di lib/print.ts
// otomatis fallback ke hidden-iframe window.print() kalau route ini 501.
export async function POST() {
  return NextResponse.json({ error: 'native print not configured' }, { status: 501 })
}

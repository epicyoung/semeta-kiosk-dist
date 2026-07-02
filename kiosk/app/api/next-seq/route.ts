import { NextRequest, NextResponse } from 'next/server'
import { eventFolder, nextSeq, padSeq } from '@/lib/event'

/** POST { event_name } → { seq, paddedSeq, eventFolder }. Persistent counter per event. */
export async function POST(req: NextRequest) {
  const { event_name } = await req.json()
  if (typeof event_name !== 'string' || !event_name.trim()) {
    return NextResponse.json({ error: 'event_name required' }, { status: 400 })
  }
  const folder = eventFolder(event_name)
  const seq = nextSeq(folder)
  return NextResponse.json({ seq, paddedSeq: padSeq(seq), eventFolder: folder })
}

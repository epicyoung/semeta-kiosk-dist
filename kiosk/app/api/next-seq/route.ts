import { NextRequest, NextResponse } from 'next/server'
import { eventFolder, nextSeq, padSeq } from '@/lib/event'
import { assertLocalMutation } from '@/lib/local-request'

/** POST { event_name } → { seq, paddedSeq, eventFolder }. Persistent counter per event. */
export async function POST(req: NextRequest) {
  try { assertLocalMutation(req) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Ditolak' }, { status: 403 }) }
  const { event_name } = await req.json()
  if (typeof event_name !== 'string' || !event_name.trim()) {
    return NextResponse.json({ error: 'event_name required' }, { status: 400 })
  }
  const folder = eventFolder(event_name)
  try {
    const seq = nextSeq(folder)
    return NextResponse.json({ seq, paddedSeq: padSeq(seq), eventFolder: folder })
  } catch (err) {
    // Gagal di sini = STOP, jangan jalan terus. Nomor yang salah bikin QR tamu
    // nunjuk foto orang lain + nimpa file di R2 (insiden 2026-09-12).
    console.error('[next-seq] counter tidak terbaca untuk', folder, err)
    return NextResponse.json(
      { error: 'seq_unavailable', eventFolder: folder, detail: String((err as Error)?.message ?? err) },
      { status: 500 }
    )
  }
}

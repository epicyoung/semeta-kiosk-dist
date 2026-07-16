import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { reactionFilename, reactionsDirPath } from '@/lib/event'

export const runtime = 'nodejs'

/**
 * POST multipart/form-data { video: Blob, event_name: string, stamp: string }
 * Writes muted reaction .webm to C:/semeta/reactions. Local only — never uploaded (YAGNI).
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const video = form.get('video')
    const eventName = String(form.get('event_name') ?? 'event')
    const stamp = String(form.get('stamp') ?? '')
    if (!(video instanceof Blob) || !stamp) {
      return NextResponse.json({ error: 'video + stamp required' }, { status: 400 })
    }
    const dir = reactionsDirPath()
    fs.mkdirSync(dir, { recursive: true })
    const buf = Buffer.from(await video.arrayBuffer())
    const filePath = path.join(dir, reactionFilename(eventName, stamp))
    fs.writeFileSync(filePath, buf)
    return NextResponse.json({ path: filePath })
  } catch (err) {
    console.error('save-reaction failed:', err)
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}

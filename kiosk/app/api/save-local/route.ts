import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { eventFolder, eventDirPath, originalFilename, aiFilename } from '@/lib/event'

/**
 * POST { event_name, seq, kind: 'original'|'ai', image_base64 }
 * Writes the full-res photo to C:/semeta/event/<folder>/<conventional-name>. Local print only.
 */
export async function POST(req: NextRequest) {
  const { event_name, seq, kind, image_base64 } = await req.json()
  if (typeof event_name !== 'string' || typeof seq !== 'string' || typeof image_base64 !== 'string') {
    return NextResponse.json({ error: 'event_name, seq, image_base64 required' }, { status: 400 })
  }
  if (kind !== 'original' && kind !== 'ai') return NextResponse.json({ error: 'kind must be original or ai' }, { status: 400 })

  const filename = kind === 'ai'
    ? aiFilename(event_name, seq)
    : originalFilename(event_name, seq)
  const dir = eventDirPath(eventFolder(event_name))
  fs.mkdirSync(dir, { recursive: true })

  // accept raw base64 or a data: URL
  const b64 = image_base64.includes(',') ? image_base64.split(',')[1] : image_base64
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, Buffer.from(b64, 'base64'))

  return NextResponse.json({ path: filePath, filename })
}

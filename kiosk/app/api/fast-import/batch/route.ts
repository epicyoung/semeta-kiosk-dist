import { NextResponse } from 'next/server'
import { fetchKioskConfig } from '@/lib/kiosk-config'
import { getImportQueue } from '@/lib/fast-import'
import { assertLocalMutation, boundedBytes } from '@/lib/local-request'
import type { FrameBytes } from '@/lib/smart-frame'

export const runtime = 'nodejs'
export async function POST(request: Request) {
  try {
    assertLocalMutation(request)
    const config = await fetchKioskConfig()
    const frames: FrameBytes[] = []
    let warning: string | undefined
    for (const frame of config.frames.slice(0, 10)) {
      try {
        const response = await fetch(new URL(frame.url, request.url), { signal: AbortSignal.timeout(10_000) })
        if (!response.ok) throw new Error('Frame unavailable')
        frames.push({ id: frame.id, bytes: Buffer.from(await boundedBytes(response, 20 * 1024 * 1024)) })
      } catch { warning = 'Sebagian frame gagal dibaca; foto tanpa frame yang sesuai memakai original' }
    }
    const queue = getImportQueue()
    const batch = await queue.createBatch(config.event_name, frames, warning)
    queue.start()
    return NextResponse.json({ batch })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Gagal membuat batch' }, { status: 400 })
  }
}

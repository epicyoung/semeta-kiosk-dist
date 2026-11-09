import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import os from 'node:os'
import { assertLocalMutation } from '@/lib/local-request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Reset kamera gphoto2 yang STUCK (macOS/Linux). Bunuh:
//   1. gphoto2 yang nyangkut (capture ke-gantung melebihi timeout)
//   2. PTPCamera — daemon macOS yang rebut USB begitu kamera dicolok (biang "Could not claim")
// Idempotent: proses ga ada → exit non-zero → diabaikan, tetep balas ok.
function kill(cmd: string, args: string[]): Promise<void> {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: 5000 }, () => resolve())
  })
}

export async function POST(req: NextRequest) {
  try { assertLocalMutation(req) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Ditolak' }, { status: 403 }) }

  const mac = os.platform() === 'darwin'
  // gphoto2 nyangkut — bunuh di semua platform (mac & linux)
  await kill('pkill', ['-9', '-f', 'gphoto2'])
  // PTPCamera cuma ada di macOS
  if (mac) await kill('killall', ['-9', 'PTPCamera'])
  return NextResponse.json({ ok: true, platform: os.platform() })
}

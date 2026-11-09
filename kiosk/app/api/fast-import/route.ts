import { NextRequest, NextResponse } from 'next/server'
import { getImportQueue } from '@/lib/fast-import'
import { assertLocalMutation, assertLocalRead, boundedBytes } from '@/lib/local-request'
import { IMPORT_MAX_BYTES } from '@/lib/smart-frame'

export const runtime = 'nodejs'
export async function GET(req: NextRequest) {
  try {
    assertLocalRead(req)
    const queue = getImportQueue()
    queue.start()
    return NextResponse.json({ jobs: queue.jobs().slice(0, 500) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Gagal membaca antrean import' }, { status: 500 })
  }
}
export async function POST(request: Request) {
  try {
    assertLocalMutation(request)
    const bytes = await boundedBytes(request, IMPORT_MAX_BYTES + 1024 * 1024)
    const form = await new Response(new Uint8Array(bytes), { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } }).formData()
    const file = form.get('file')
    const batchId = form.get('batch_id')
    if (!file || typeof file === 'string' || typeof batchId !== 'string') throw new Error('File dan batch diperlukan')
    const queue = getImportQueue()
    const job = await queue.ingest(batchId, file.name, Buffer.from(await file.arrayBuffer()))
    queue.start()
    return NextResponse.json({ job })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Gagal menerima file' }, { status: 400 })
  }
}
export async function PATCH(request: Request) {
  try {
    assertLocalMutation(request)
    const body = await request.json()
    if (typeof body.id !== 'string' || !['pause', 'resume', 'retry', 'cancel'].includes(body.action)) throw new Error('Aksi tidak valid')
    return NextResponse.json({ job: getImportQueue().control(body.id, body.action) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Gagal mengubah antrean' }, { status: 400 })
  }
}

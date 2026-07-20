import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'
import { isSafeAssetFilename } from '@/lib/local-asset-guard'
import fs from 'fs'
import path from 'path'

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get('file')
  if (!isSafeAssetFilename(file)) {
    return NextResponse.json({ error: 'Invalid file parameter' }, { status: 400 })
  }

  const dataDir = localDb.getTemplateLocal()
  const filePath = path.join(dataDir, 'assets', file)

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const buf = fs.readFileSync(filePath)
  const ext = path.extname(file).toLowerCase()
  let mime = 'application/octet-stream'
  if (ext === '.png') mime = 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg'

  return new NextResponse(buf, {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=86400'
    }
  })
}

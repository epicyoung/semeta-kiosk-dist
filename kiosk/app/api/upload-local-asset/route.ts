import { NextRequest, NextResponse } from 'next/server'
import { localDb } from '@/lib/local-db'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'node:crypto'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const ext = path.extname(file.name) || '.png'
    const fileName = `${randomUUID()}${ext}`
    
    // Save to local data dir under /assets folder
    const dataDir = localDb.getTemplateLocal()
    const assetsDir = path.join(dataDir, 'assets')
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true })
    }
    
    const filePath = path.join(assetsDir, fileName)
    fs.writeFileSync(filePath, buffer)
    
    // Return a proxy URL so the kiosk frontend can load it
    const url = `/api/local-asset?file=${fileName}`
    
    return NextResponse.json({ url })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Upload failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

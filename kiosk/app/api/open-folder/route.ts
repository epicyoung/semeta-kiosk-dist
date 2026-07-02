import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import path from 'path'

export async function POST() {
  const folderPath = path.resolve(process.cwd(), 'face_server', 'put-template-here')
  exec(`explorer "${folderPath}"`)
  return NextResponse.json({ ok: true })
}

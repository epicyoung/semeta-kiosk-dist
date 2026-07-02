import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    email: process.env.POCKETBASE_EMAIL ?? '',
    password: process.env.POCKETBASE_PASSWORD ?? '',
  })
}

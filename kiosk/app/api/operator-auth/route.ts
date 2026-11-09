import { NextRequest, NextResponse } from 'next/server'
import { assertLocalMutation } from '@/lib/local-request'
import { OPERATOR_COOKIE, OPERATOR_TTL_SEC, operatorCookieValue, verifyOperatorPin } from '@/lib/operator-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST { pin } → set cookie httpOnly 12 jam. Dipakai Settings panel. */
export async function POST(req: NextRequest) {
  try {
    assertLocalMutation(req)
    const { pin } = await req.json().catch(() => ({ pin: '' }))
    if (typeof pin !== 'string' || !verifyOperatorPin(pin)) {
      return NextResponse.json({ error: 'PIN salah' }, { status: 401 })
    }
    const res = NextResponse.json({ ok: true })
    res.cookies.set(OPERATOR_COOKIE, operatorCookieValue(), {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: OPERATOR_TTL_SEC,
    })
    return res
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal' }, { status: 403 })
  }
}

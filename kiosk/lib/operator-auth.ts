import { createHmac, timingSafeEqual } from 'node:crypto'
import { localDb } from './local-db'

/** Cookie httpOnly yang didapat setelah operator memasukkan PIN Settings. */
export const OPERATOR_COOKIE = 'semeta_operator'
const TTL_MS = 12 * 60 * 60 * 1000

function signingKey(): string {
  return process.env.KIOSK_OPERATOR_SECRET || localDb.getSecret() || 'semeta-local-operator'
}

/** PIN operator: env > settings.operator_pin > default 1234 (ganti di lapangan). */
export function expectedOperatorPin(): string {
  const fromEnv = process.env.KIOSK_OPERATOR_PIN
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  const fromSettings = (localDb.getSettings() as Record<string, unknown>).operator_pin
  if (typeof fromSettings === 'string' && fromSettings.trim()) return fromSettings.trim()
  return '1234'
}

export function verifyOperatorPin(pin: string): boolean {
  const a = Buffer.from(pin)
  const b = Buffer.from(expectedOperatorPin())
  return a.length === b.length && timingSafeEqual(a, b)
}

function sign(exp: number): string {
  return createHmac('sha256', signingKey()).update(`operator:${exp}`).digest('hex')
}

export function operatorCookieValue(): string {
  const exp = Date.now() + TTL_MS
  return `${exp}.${sign(exp)}`
}

export function isOperator(request: Request): boolean {
  const cookie = request.headers.get('cookie') ?? ''
  const match = cookie.match(/(?:^|;\s*)semeta_operator=([^;]+)/)
  if (!match) return false
  const [expRaw, signature] = decodeURIComponent(match[1]).split('.')
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || exp < Date.now()) return false
  const want = sign(exp)
  if (!signature || signature.length !== want.length) return false
  return timingSafeEqual(Buffer.from(signature), Buffer.from(want))
}

/** Untuk route operator-only (restart/update/open-folder/save-settings/...). */
export function requireOperator(request: Request): void {
  if (!isOperator(request)) throw new Error('Operator belum terautentikasi')
}

export const OPERATOR_TTL_SEC = TTL_MS / 1000

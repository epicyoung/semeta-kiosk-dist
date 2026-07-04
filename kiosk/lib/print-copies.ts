// Clamp jumlah copies dari client sebelum dilempar ke printer. Pure, no deps —
// dipisah dari route.ts biar bisa dites via node:assert tanpa nge-import Next/Sumatra.
export const MAX_COPIES = 10

/** Clamp copies ke 1..MAX_COPIES; non-angka / <1 → 1, >MAX → MAX. */
export function clampCopies(raw: unknown): number {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(MAX_COPIES, Math.max(1, Math.trunc(n))) : 1
}

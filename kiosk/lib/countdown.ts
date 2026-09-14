// Countdown sebelum jepret. Operator pilih di Settings: Mati / 3 detik / 5 detik.
// Dipakai LiveViewScreen + MultiCaptureScreen — satu sumber biar dua screen ga drift.

export const COUNTDOWN_DEFAULT = 3

// Interval per angka. 1000ms = label "3 detik" beneran 3 detik.
export const COUNTDOWN_TICK_MS = 1000

export const COUNTDOWN_OPTIONS = [0, 3, 5] as const

/**
 * Deret angka yang ditampilkan sebelum jepret. 0 ⇒ [] (langsung jepret, flash tetap ada).
 * Nilai di luar COUNTDOWN_OPTIONS (config korup / diedit manual) → clamp ke default.
 */
export function countdownTicks(seconds: number): number[] {
  const n = (COUNTDOWN_OPTIONS as readonly number[]).includes(seconds)
    ? seconds
    : COUNTDOWN_DEFAULT
  return Array.from({ length: n }, (_, i) => n - i)
}

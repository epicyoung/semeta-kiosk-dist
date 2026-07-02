// License gate types + helpers. Kiosk = produk sewa; KIOSK_SECRET = license check.
// Server (page.tsx) gate keras; client (KioskApp) enforce runtime + grace offline 12 jam.

export type LockReason =
  | 'needs_activation'  // belum di-Top Up / secret invalid / belum pernah aktivasi
  | 'needs_reconfirm'   // pernah aktivasi tapi offline > 12 jam
  | 'expired'           // sesi habis
  | 'disabled'          // kiosk di-disable / device mismatch
  | 'force_locked'      // admin lock manual

export type LicenseRecord = {
  session_id: string
  remaining_sec: number
  lastOkAt: number // epoch ms handshake sukses terakhir — dasar window grace
}

// Sekali teraktivasi, boleh offline selama window ini sebelum wajib re-confirm.
export const RECONFIRM_WINDOW_MS = 12 * 60 * 60 * 1000 // 12 jam

// Verdict worker (non-200 yang DIJAWAB) → reason lock. Network error bukan ini (itu offline → grace).
export function reasonForStatus(status: number): LockReason {
  if (status === 402) return 'expired'
  if (status === 403) return 'disabled'
  return 'needs_activation' // 401 (no secret) / 404 (no session) / lainnya
}

// Sudah pernah aktivasi DAN masih dalam window 12 jam = boleh jalan offline.
export function withinGrace(rec: LicenseRecord | null, now: number): boolean {
  if (!rec) return false
  return now - rec.lastOkAt < RECONFIRM_WINDOW_MS
}

// Watermark-clean while offline ONLY when the cached "licensed" verdict is still trustworthy.
// Tighter than the 12h lock grace: a blip keeps the kiosk running (withinGrace) but a STALE
// cache must not hand out clean photos for free. Stale = older than 1h OR older than the
// rental time it claimed was left (sewa would've ended by now anyway).
// ponytail: affects preview + face_server local burn only — the R2 copy is always decided
// by the worker at upload, so this can't leak the guest-facing copy.
export const WM_CACHE_MAX_MS = 60 * 60 * 1000 // 1 jam
export function offlineLicensedFresh(rec: LicenseRecord | null, now: number): boolean {
  if (!rec) return false
  const age = now - rec.lastOkAt
  return age < WM_CACHE_MAX_MS && age < rec.remaining_sec * 1000
}

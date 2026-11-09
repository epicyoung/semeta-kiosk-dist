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

// ── Satu sumber keputusan lisensi ───────────────────────────────────────────
// Jawaban Worker punya bentuk yang sama di handshake (checkLicenseGate, page.tsx)
// dan heartbeat runtime (billing.ts). Derivasi keputusannya dikunci DI SINI — pure,
// no I/O — biar state lisensi cuma satu tempat buat dibaca (DX/agent experience).

export type WorkerBody = {
  status?: string
  bypassed?: boolean
  freeware?: boolean
  force_locked?: boolean
  lock_message?: string
  licensed?: boolean
  remaining_sec?: number
}

// force_locked = FLAG, bukan kind: dua call site memetakannya beda (handshake → lock
// keras; heartbeat → refill + FORCE_LOCKED) tapi nilai refill tetap milik kind-nya.
export type WorkerVerdict =
  | { kind: 'bypassed' }
  | { kind: 'licensed'; remaining_sec: number; force_locked: boolean; lock_message?: string }
  | { kind: 'freeware'; force_locked: boolean; lock_message?: string }
  | { kind: 'locked'; reason: LockReason; message?: string }

export function workerVerdict(body: WorkerBody | null | undefined, status: number): WorkerVerdict {
  const b = body ?? {}
  const force = b.force_locked === true
  const lockMessage = typeof b.lock_message === 'string' ? b.lock_message : undefined
  const msg = lockMessage ? { lock_message: lockMessage } : {}
  if (status === 200) {
    if (b.status === 'bypassed' || b.bypassed) return { kind: 'bypassed' }
    if (b.freeware) return { kind: 'freeware', force_locked: force, ...msg }
    const remaining = typeof b.remaining_sec === 'number' ? b.remaining_sec : 0
    // Prefer verdict Worker; fallback derive (aturan sama) buat Worker lama tanpa field licensed.
    const licensed = typeof b.licensed === 'boolean'
      ? b.licensed
      : b.status === 'ACTIVE' && remaining > 0
    if (licensed) return { kind: 'licensed', remaining_sec: remaining, force_locked: force, ...msg }
    return { kind: 'freeware', force_locked: force, ...msg }
  }
  if (status === 404) {
    // Admin bisa takeover kiosk freeware → force_lock menang walau belum ada sewa.
    if (force) return { kind: 'locked', reason: 'force_locked', ...(lockMessage ? { message: lockMessage } : {}) }
    return { kind: 'freeware', force_locked: false }
  }
  return { kind: 'locked', reason: reasonForStatus(status) }
}

/** Flag force-lock dari verdict apa pun (bypassed/locked tidak bawa flag). */
export function verdictForce(v: WorkerVerdict): { force_locked: boolean; lock_message?: string } {
  if (v.kind === 'licensed' || v.kind === 'freeware') {
    return v.force_locked ? { force_locked: true, lock_message: v.lock_message } : { force_locked: false }
  }
  return { force_locked: false }
}

// Offline (network error / Worker unreachable): lock gate 12 jam, watermark gate 1 jam.
export type OfflineVerdict =
  | { kind: 'grace'; remaining_sec: number; watermark_clean: boolean }
  | { kind: 'locked'; reason: 'needs_activation' | 'needs_reconfirm' }

export function offlineVerdict(rec: LicenseRecord | null, now: number): OfflineVerdict {
  if (withinGrace(rec, now))
    return { kind: 'grace', remaining_sec: rec!.remaining_sec, watermark_clean: offlineLicensedFresh(rec, now) }
  return { kind: 'locked', reason: rec ? 'needs_reconfirm' : 'needs_activation' }
}

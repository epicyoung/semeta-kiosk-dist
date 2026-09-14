// Supervisor digiCamControl — "live view yang ngurus dirinya sendiri".
//
// Masalah di lapangan: dCC dipakai seharian, lama-lama nge-hang total. Restart
// live view lewat HTTP ga mempan karena app-nya sendiri udah ga respon, jadi
// operator harus Ctrl+Alt+Del, kill manual, buka lagi — di tengah acara.
//
// Eskalasi WAJIB dari yang paling murah. Force quit itu 3-8 detik kamera mati;
// jangan dipakai buat masalah yang cukup diselesaikan dgn LiveViewWnd_Show.
//
//   dCC ga jalan        → launch
//   frame ga ada / beku → show           (murah, ~0.4 detik)
//   show 2x ga mempan   → kill lalu launch
//
// Fungsi di file ini PURE — keputusannya bisa dites tanpa nyentuh proses
// Windows beneran. Eksekusinya di app/api/canon-live/route.ts.

/** Lokasi instal standar digiCamControl di Windows. */
export const DCC_DEFAULT_PATH = 'C:/Program Files (x86)/digiCamControl/CameraControl.exe'

/** Berapa lama frame identik dianggap beku. */
export const FREEZE_MS = 3_000

/** SHOW dicoba segini kali sebelum naik ke force quit. */
export const MAX_SHOW_BEFORE_KILL = 2

/** Jeda minimal antar force quit — dCC butuh waktu booting. */
export const KILL_COOLDOWN_MS = 20_000

export type DccAction = 'none' | 'show' | 'launch' | 'kill' | 'cooldown'

export type DccState = {
  dccAlive: boolean     // proses CameraControl.exe kedeteksi
  frameOk: boolean      // frame JPEG terakhir kebaca
  frozenMs: number      // udah berapa lama frame-nya identik
  showAttempts: number  // SHOW berturut-turut yang belum membuahkan frame seger
  lastKillAt: number    // timestamp kill terakhir (0 = belum pernah)
  now: number
}

/**
 * Tentuin langkah berikutnya. Satu keputusan per panggilan — pemanggilnya yang
 * ngulang tiap poll, jadi eskalasinya bertahap, bukan borongan sekaligus.
 */
export function nextAction(s: DccState): DccAction {
  // dCC ga ada prosesnya = ga ada yang bisa di-Show maupun dibunuh. Ini juga
  // jalur normal sesudah kill sukses, jadi dicek SEBELUM cooldown.
  if (!s.dccAlive) return 'launch'

  const frozen = s.frozenMs >= FREEZE_MS
  if (s.frameOk && !frozen) return 'none'

  // Masih ada jatah SHOW — coba yang murah dulu.
  if (s.showAttempts < MAX_SHOW_BEFORE_KILL) return 'show'

  // SHOW udah mentok. Force quit, tapi jangan beruntun: sesudah kill, dCC butuh
  // waktu booting dan frame emang belum ada. Tanpa rem ini jadi loop kill.
  if (s.lastKillAt && s.now - s.lastKillAt < KILL_COOLDOWN_MS) return 'cooldown'

  return 'kill'
}

/**
 * Path exe dCC yang aman di-spawn. Path ini datang dari Settings (diketik
 * operator), dan masuk ke spawn() — tanpa validasi, itu jalur eksekusi program
 * sembarang. Harus .exe, tanpa karakter yang bisa nyambung perintah lain.
 */
export function isValidDccPath(p: unknown): p is string {
  if (typeof p !== 'string') return false
  const t = p.trim()
  if (t.length === 0 || t.length > 400) return false
  if (t !== p) return false
  // Karakter operator shell + baris baru + NUL.
  if (/[&|;<>^"'`$\r\n\0]/.test(t)) return false
  if (t.includes('..')) return false
  if (!/\.exe$/i.test(t)) return false
  // Harus path absolut Windows: "C:/..." atau "C:\...".
  if (!/^[A-Za-z]:[\\/]/.test(t)) return false
  return true
}

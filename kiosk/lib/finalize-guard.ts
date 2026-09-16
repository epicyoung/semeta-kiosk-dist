// Guard dobel-finalize, dipisah dari ProcessingScreen biar bisa dites.
//
// Dua tekanan yang saling lawan, dan tiap kali salah satu menang sendirian ada tamu yang kena:
//
//  1. DALAM satu run generate, finalize ga boleh jalan dua kali. Effect processing bisa
//     ke-invoke dobel (StrictMode dev, dep berubah) → dua finalizeLocal → dua next-seq →
//     file & entri microsite DOBEL (#010 == #011, isi identik). Ini bug bf04ca4.
//
//  2. ANTAR run generate, guard-nya WAJIB kebuka lagi. Ref itu selamat dari re-render —
//     dan itu juga artinya dia selamat dari re-run effect yang tanpa unmount (toggle
//     hashchange #error ↔ generate). Dulu: tamu A sukses ⇒ terkunci; effect jalan lagi buat
//     tamu B ⇒ finalize langsung no-op ⇒ file tamu B ga pernah ditulis, base undefined,
//     QR/microsite masih nunjuk aset TAMU A. Foto orang lain nyampe ke tamu lain.
//
// Makanya izinnya dipegang per-RUN (beginRun), bukan per-mount. Satu run = satu izin.

export type FinalizeGuard = {
  /** Buka izin buat run generate baru. Panggil di awal effect, bukan di cleanup. */
  beginRun(): void
  /** true = boleh finalize sekarang (dan izinnya langsung kepakai). false = udah kepakai. */
  claim(): boolean
  /** Balikin izin — dipanggil pas finalize GAGAL, biar retry beneran bisa jalan. */
  release(): void
  /** Buat test/introspeksi. */
  readonly claimed: boolean
}

export function createFinalizeGuard(): FinalizeGuard {
  let claimed = false
  return {
    beginRun() { claimed = false },
    claim() {
      if (claimed) return false
      claimed = true
      return true
    },
    release() { claimed = false },
    get claimed() { return claimed },
  }
}

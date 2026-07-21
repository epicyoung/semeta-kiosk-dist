// Multi-template upload plan — deterministik, INDEX-BASED (bukan URL-based).
//
// Kenapa index: filter-by-URL lama (`r.rawAiUrl !== chosenRawAi`) bisa salah buang saat
// dua template balikin URL bentrok, atau NOL kebuang saat state mismatch → sebagian _M ilang
// di microsite. Index anti-itu: "tamu pilih N hasil → chosen jadi _B, sisanya _M1..N-1 urut".
//
// Pure + no DOM → bisa dites node:assert. PreviewScreen tinggal composite+upload sesuai plan ini.

/** Item minimal yang butuh di-plan — cuma butuh sumber gambar AI mentah. */
export type MultiResult = { rawAiUrl?: string; aiUrl: string }

export type UploadPlan = {
  /** Sumber _B (hasil yang lagi dipilih/ditampilkan). */
  chosen: MultiResult
  /** Sumber _M1, _M2, … berurutan — semua hasil SELAIN yang dipilih, urut index asli. */
  others: MultiResult[]
}

/**
 * Bikin rencana upload dari daftar hasil + index yang dipilih.
 * - allResults kosong/undefined → caller pakai single-path (return null).
 * - chosenIndex di luar rentang → clamp ke 0 (fail-safe, jangan crash).
 */
export function planMultiUpload(
  allResults: MultiResult[] | undefined,
  chosenIndex: number,
): UploadPlan | null {
  if (!allResults || allResults.length === 0) return null
  const idx = chosenIndex >= 0 && chosenIndex < allResults.length ? chosenIndex : 0
  return {
    chosen: allResults[idx],
    others: allResults.filter((_, i) => i !== idx),
  }
}

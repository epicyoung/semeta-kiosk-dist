import type { SwapResult } from './types'

/** Gambar hasil swap ulang — tiga bentuk yang dipegang tiap entri hasil.
 *  `rawAiUrl` = versi BERSIH (belum ber-watermark); ini yang jadi sumber kalau tamu
 *  swap lagi, biar watermark ga numpuk tiap edit. */
export type RefinedImages = {
  aiUrl: string
  originalUrl: string
  rawAiUrl: string
}

export type RefineOutcome = {
  results: SwapResult[]
  /** Entri sebelum diganti — dipegang buat tombol Undo. null = ga ada yang diganti. */
  previous: SwapResult | null
}

/** Ganti SATU entri di allResults sama hasil swap ulang. Pure — dites di refine-result.test.ts.
 *
 *  Yang diganti cuma gambarnya; `templateId`, `base`, `sourceUrl`, `processingSec` ikut entri
 *  lama. `base` khususnya WAJIB dipertahanin — itu session id buat key R2, kalau ikut berubah
 *  planMultiUpload bakal upload ke key yang beda dan QR nunjuk foto yang salah.
 *
 *  Index ngawur ⇒ list balik apa adanya + previous null, BUKAN ngelempar: ini jalur UI yang
 *  jalan pas tamu udah berdiri di depan booth, mending ga ngapa-ngapain daripada crash. */
export function refineResult(
  results: SwapResult[],
  index: number,
  images: RefinedImages,
): RefineOutcome {
  if (index < 0 || index >= results.length) return { results, previous: null }
  const previous = results[index]
  const next = results.map((r, i) =>
    i === index ? { ...r, aiUrl: images.aiUrl, originalUrl: images.originalUrl, rawAiUrl: images.rawAiUrl } : r,
  )
  return { results: next, previous }
}

/** Pemetaan awal muka-AI → muka-selfie, urut kiri-ke-kanan.
 *
 *  Dipake buat ngisi panel remap duluan supaya tamu tinggal Next kalau AI ga nuker posisi
 *  orang — kasus mayoritas di foto 2 orang. Muka AI yang ga kebagian pasangan dapet `null`
 *  (face_server ngelewatin, mukanya dibiarin hasil AI). Pure — dites. */
export function initialMapping(aiFaceCount: number, selfieFaceCount: number): (number | null)[] {
  return Array.from({ length: aiFaceCount }, (_, i) => (i < selfieFaceCount ? i : null))
}

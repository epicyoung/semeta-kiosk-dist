// Kolam foto buat penyusun strip 2R (mode AI). Murni data — dites di strip-pool.test.ts.
//
// DUA URL PER FOTO, JANGAN DIGABUNG:
//   thumbUrl → yang tampil di layar. BERWATERMARK saat unlicensed (aiUrl/originalUrl udah
//              di-burn di ProcessingScreen). Gerbang freemium: tamu ga boleh liat bersih
//              di layar, bisa difoto pakai HP.
//   cleanUrl → bahan compose. BERSIH (rawAiUrl/sourceUrl). Nyusun dari thumbUrl bikin
//              watermark keulang 4x dalam satu strip; watermark dibakar SEKALI di sheet jadi.
//
// Frame 4R sengaja ga ikut ke mana-mana di sini — dia dibakar pas print di doPrint().
// Strip 2R punya overlay sendiri (config.ai_strip_overlay_url), dibakar di composePrintLayout.
import type { SwapResult } from './types'

export const STRIP_MAX_SLOTS = 4 // ceiling layoutSlots(); GRID_2R_S cuma sampe 4

export type StripSource = {
  id: string
  kind: 'original' | 'ai'
  thumbUrl: string
  cleanUrl: string
}

type PoolInput = {
  allResults?: SwapResult[]
  aiUrl: string
  originalUrl: string
  rawAiUrl?: string
  sourceUrl?: string
  shots?: string[]
}

/** Ori + semua hasil AI jadi satu kolam. Ori duluan — dia satu-satunya yang unik,
 *  sisanya varian. Kosong ga mungkin: minimal selalu ada Ori + 1 AI. */
export function buildStripPool(input: PoolInput): StripSource[] {
  const results: SwapResult[] = input.allResults?.length
    ? input.allResults
    : [{ templateId: 'single', aiUrl: input.aiUrl, originalUrl: input.originalUrl, rawAiUrl: input.rawAiUrl, sourceUrl: input.sourceUrl }]

  const first = results[0]
  const pool: StripSource[] = (input.shots && input.shots.length > 0)
    ? input.shots.map((shot, idx) => ({
        id: `original-${idx}`,
        kind: 'original',
        thumbUrl: idx === 0 ? first.originalUrl : shot,
        cleanUrl: idx === 0 ? (first.sourceUrl || first.originalUrl) : shot,
      }))
    : [{
        id: 'original',
        kind: 'original',
        thumbUrl: first.originalUrl,
        cleanUrl: first.sourceUrl || first.originalUrl,
      }]

  results.forEach((r, i) => {
    pool.push({
      id: `ai-${r.templateId}-${i}`, // templateId bisa kembar kalau operator pilih template sama 2x
      kind: 'ai',
      thumbUrl: r.aiUrl,
      cleanUrl: r.rawAiUrl || r.aiUrl,
    })
  })

  return pool
}

/** Slot yang bener-bener dirender. Setting admin = BATAS ATAS; kolam bisa lebih kecil
 *  (sesi 2 hasil AI + Ori = kolam 3 padahal admin set 4). Aturan sekali-pakai bikin slot
 *  ke-4 mustahil diisi — slot mati bikin tamu ngira dia yang salah, jadi ga usah dirender.
 *  0 ⇒ fitur mati, tombol Cetak 2-Strip ga muncul. */
export function stripSlotCount(adminMax: number | undefined, poolSize: number): number {
  const max = Math.trunc(adminMax ?? 0)
  if (!(max > 0) || poolSize <= 0) return 0
  return Math.max(0, Math.min(max, poolSize, STRIP_MAX_SLOTS))
}

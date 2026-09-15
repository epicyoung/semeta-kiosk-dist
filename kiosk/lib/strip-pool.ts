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
  /** Template asal foto AI ini — dipakai buat milih frame 4R per-template pas satu sesi
   *  punya beberapa template (mis. Shell A merah + B kuning). `undefined` buat foto
   *  original: dia ga punya template, dan framenya ngikut apa pun yang dipilih di slot AI. */
  templateId?: string
}

type PoolInput = {
  allResults?: SwapResult[]
  aiUrl: string
  originalUrl: string
  rawAiUrl?: string
  sourceUrl?: string
  shots?: string[]
}

/** `''` / spasi doang / bukan string = bukan gambar. burnWatermark ngebalikin input apa
 *  adanya kalau gagal, jadi string kosong dari hulu lewat tanpa dicegat sampai ke <img>. */
function isUsableUrl(u: unknown): u is string {
  return typeof u === 'string' && u.trim().length > 0
}

/** Ori + semua hasil AI jadi satu kolam. Ori duluan — dia satu-satunya yang unik,
 *  sisanya varian. Bisa KOSONG kalau semua URL-nya ga kepakai — pemanggil wajib siap
 *  (stripSlotCount ngasih 0 → tombol 2-Strip ga muncul sama sekali). */
export function buildStripPool(input: PoolInput): StripSource[] {
  const results: SwapResult[] = input.allResults?.length
    ? input.allResults
    : [{ templateId: 'single', aiUrl: input.aiUrl, originalUrl: input.originalUrl, rawAiUrl: input.rawAiUrl, sourceUrl: input.sourceUrl }]

  const first = results[0]
  const originals: StripSource[] = (input.shots && input.shots.length > 0)
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

  // Entri tanpa URL kepakai DIBUANG di sini, bukan dijaga di komponen. Kartu kosong bukan
  // cuma warning `src=""` di console: dia bisa dipilih tamu, ngisi slot, dan nyetak bidang
  // kosong di kertas yang udah kepotong. Pilihan yang ga ada gambarnya bukan pilihan.
  const pool = originals.filter(p => isUsableUrl(p.thumbUrl) && isUsableUrl(p.cleanUrl))

  // "Skip AI" ngirim SHOW_PREVIEW dengan aiUrl = foto asli (lihat skipToPreview di
  // CategoryScreen) — ga ada AI yang dibikin, cuma disalin. Tanpa saringan ini kolamnya
  // nampilin kartu berlabel "AI" yang isinya foto yang sama persis: tamu ngira dapet dua
  // hasil beda, dan bisa masukin foto kembar ke satu strip tanpa sadar.
  const originalCleanUrls = new Set(pool.map(p => p.cleanUrl))

  results.forEach((r, i) => {
    const cleanUrl = r.rawAiUrl || r.aiUrl
    if (!isUsableUrl(r.aiUrl) || !isUsableUrl(cleanUrl)) return
    if (originalCleanUrls.has(cleanUrl)) return
    pool.push({
      id: `ai-${r.templateId}-${i}`, // templateId bisa kembar kalau operator pilih template sama 2x
      kind: 'ai',
      thumbUrl: r.aiUrl,
      cleanUrl,
      templateId: r.templateId,
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

/** Isian awal slot buat kartu 2-up: kiri Original, kanan AI.
 *
 *  Tujuannya ngilangin dua tap per tamu di antrean — susunan yang 99% kepilih ya ini, jadi
 *  operator tinggal Print. Hasilnya cuma NILAI AWAL: begitu ada di state, drag/zoom/ganti
 *  foto jalan seperti biasa, jadi yang komposisinya kurang pas masih bisa dibenerin.
 *
 *  Aturan: slot 0 = original pertama, slot 1 = AI pertama. Kalau salah satu jenis ga ada
 *  (mis. tamu skip AI), sisanya diisi urut dari kolam — lebih baik selembar keisi separuh
 *  otomatis daripada kosong semua.
 *
 *  Satu foto ga boleh nempatin dua slot: aturan sekali-pakai di composer tetep dijaga di
 *  sini, kalau enggak tamu bisa nyetak dua kartu kembar tanpa sadar.
 *
 *  Pure — dites di __tests__/strip-pool.test.ts. */
export function autoFillSlots(pool: StripSource[], slots: number): (string | null)[] {
  const out: (string | null)[] = Array(Math.max(0, slots)).fill(null)
  if (out.length === 0) return out
  const used = new Set<string>()
  const take = (pred: (s: StripSource) => boolean): string | null => {
    const hit = pool.find(s => !used.has(s.id) && pred(s))
    if (!hit) return null
    used.add(hit.id)
    return hit.id
  }

  out[0] = take(s => s.kind === 'original')
  if (out.length > 1) out[1] = take(s => s.kind === 'ai')

  // Sisa slot (atau slot yang tadi ga kebagian jenisnya) diisi apa pun yang belum kepakai.
  for (let i = 0; i < out.length; i++) {
    if (out[i] === null) out[i] = take(() => true)
  }
  return out
}

/** Frame 4R mana yang dipakai buat selembar kertas.
 *
 *  Masalahnya: `ai_4r_overlay_url` itu SATU setting global, sementara satu sesi bisa punya
 *  beberapa template dengan frame beda (Shell A merah vs B kuning). Operator cuma bisa naro
 *  satu file di Settings, jadi template kedua bakal kecetak pakai frame yang salah.
 *
 *  Aturannya: foto AI yang kepilih nentuin framenya, lewat `overlay_url` template asalnya
 *  (frame per-template dari sidecar). Foto original ga punya template — dia ikut frame
 *  siapa pun yang ada di lembar yang sama.
 *
 *  Kalau dua slot dari template BEDA, ga ada jawaban yang bener buat satu lembar: dikasih
 *  `null` biar pemanggil bisa nolak / minta operator pilih, bukan diem-diem nyetak salah satu.
 *  Fallback ke setting global cuma pas ga ada template yang punya frame sendiri.
 *
 *  Pure — dites di __tests__/strip-pool.test.ts. */
export function resolve4rOverlay(
  picked: { templateId?: string }[],
  overlayByTemplate: Record<string, string | null | undefined>,
  globalOverlay: string | null | undefined,
): { url: string | null; conflict: boolean } {
  const urls = new Set<string>()
  for (const p of picked) {
    if (!p.templateId) continue
    const u = overlayByTemplate[p.templateId]
    if (isUsableUrl(u)) urls.add(u)
  }
  if (urls.size === 0) return { url: globalOverlay || null, conflict: false }
  if (urls.size > 1) return { url: null, conflict: true }
  return { url: [...urls][0], conflict: false }
}

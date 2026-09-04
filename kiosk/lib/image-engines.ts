// Mirror DISPLAY-ONLY dari worker/src/image-engines.ts. Kiosk cuma butuh tau: model apa aja
// yang ada, resolusi apa aja per model, dan key mana yang mesti dikirim ke /api/generate.
//
// Ini BUKAN sumber kebenaran. Harga beneran dari handshake (image_costs, diatur super-admin di
// /dashboard/settings), model+resolusi beneran dari registry Worker, potong token dari RPC
// deduct_image_tokens. Kalau file ini bohong, yang rugi cuma tampilan — Worker fail-closed
// (key di luar registry = 400, engine disabled = 403), token gak kepotong buat barang salah.
//
// Nambah engine baru: tambah di worker/src/image-engines.ts + SQL app_settings.engines DULU,
// baru ke sini. Key HARUS sama persis.

export type ImageModelId =
  | 'nano-banana-pro-google' | 'nano-banana-2-google' | 'nano-banana-lite-google'
  | 'nano-banana-google'
  | 'nano-banana-pro' | 'nano-banana-2'
// '-' = jalur Fal: endpoint /edit-nya ga punya param resolusi, jadi resolusinya "ikut default
// endpoint". Sengaja BUKAN '1K' — biar ga keliatan sebanding sama key Google 1K yang harganya beda.
export type ImageResolution = '1K' | '2K' | '4K' | '-'

export type ImageModelDef = {
  id: ImageModelId
  label: string
  /** Resolusi yang punya key registry. Nano legacy cuma 1K — bukan batasan Google, tapi emang
   *  cuma itu yang didaftarin (murah = kelas entry, ga perlu varian mahal). */
  resolutions: ImageResolution[]
}

// Urutan = urutan dropdown, DAN urutan fallback pas pilihan operator basi (lihat
// reconcileSelection). Google direct duluan karena HPP-nya lebih murah dari Fal (reseller);
// Fal ditaro belakangan sebagai jalan keluar kalau Gemini API lagi rewel di tengah event.
export const IMAGE_MODELS: ImageModelDef[] = [
  { id: 'nano-banana-2-google',   label: 'Nano Banana 2 · Google',        resolutions: ['1K', '2K', '4K'] },
  // Lite CUMA 1K — bukan kelalaian ngisi daftar. Google emang ga nyediain 2K/4K buat model
  // ini; kalau dipaksa masuk, Worker ngelolosin (key-nya ga ada) atau Google nolak 400.
  { id: 'nano-banana-lite-google', label: 'Nano Banana 2 Lite · Google',  resolutions: ['1K'] },
  { id: 'nano-banana-pro-google', label: 'Nano Banana Pro · Google',      resolutions: ['1K', '2K', '4K'] },
  { id: 'nano-banana-google',     label: 'Nano Banana (legacy) · Google', resolutions: ['1K'] },
  { id: 'nano-banana-2',          label: 'Nano Banana 2 · Fal',           resolutions: ['-'] },
  { id: 'nano-banana-pro',        label: 'Nano Banana Pro · Fal',         resolutions: ['-'] },
]

// (model, resolusi) → key registry. Key-nya opaque buat kiosk: cuma dikirim apa adanya ke
// Worker. Ditulis eksplisit (bukan di-generate dari string) supaya typo ketahan di TypeScript
// dan gampang di-grep barengan sama worker/src/image-engines.ts + SQL-nya.
const ENGINE_KEYS: Record<ImageModelId, Partial<Record<ImageResolution, string>>> = {
  'nano-banana-pro-google': { '1K': 'img_nano_pro_google_1k', '2K': 'img_nano_pro_google_2k', '4K': 'img_nano_pro_google_4k' },
  'nano-banana-2-google':   { '1K': 'img_nano2_google_1k',    '2K': 'img_nano2_google_2k',    '4K': 'img_nano2_google_4k'    },
  'nano-banana-lite-google': { '1K': 'img_nano_lite_google_1k' },
  'nano-banana-google':     { '1K': 'img_nano_google_1k' },
  'nano-banana-pro':        { '-': 'img_nano_pro_fal' },
  'nano-banana-2':          { '-': 'img_nano2_fal'    },
}

/** (model, resolusi) → key image engine. null = kombinasi ga terdaftar (mis. legacy 4K).
 *  Pure — dites di image-engines.test.mjs. */
export function engineKeyFor(model: string, resolution: string): string | null {
  return ENGINE_KEYS[model as ImageModelId]?.[resolution as ImageResolution] ?? null
}

/** Model yang PUNYA minimal satu resolusi enabled di admin. costs = image_costs dari handshake.
 *  Kosong ⇒ belum pernah handshake / semua OFF: balikin [] biar UI bilang "belum ada model",
 *  BUKAN nampilin daftar palsu yang bakal ditolak Worker pas generate. */
export function enabledModels(costs: Record<string, number>): ImageModelDef[] {
  return IMAGE_MODELS
    .map(m => ({ ...m, resolutions: m.resolutions.filter(r => costs[engineKeyFor(m.id, r) ?? ''] != null) }))
    .filter(m => m.resolutions.length > 0)
}

/** Harga token PER FOTO buat (model, resolusi) dari image_costs handshake. null = ga enabled/ga ada.
 *  Sejak migrasi 20260817000003 angka di app_settings.engines.cost artinya harga satu gambar,
 *  bukan borongan 4 — total dihitung totalCostFor(). */
export function costFor(costs: Record<string, number>, model: string, resolution: string): number | null {
  const key = engineKeyFor(model, resolution)
  return key ? costs[key] ?? null : null
}

/** Pilihan jumlah variasi yang ditawarin ke operator. Batas atas 4 dikunci juga di Worker
 *  (clampVariants) dan di SQL (deduct_image_tokens) — ini cuma yang paling luar. */
export const VARIANT_CHOICES = [1, 2, 3, 4] as const

/** Total token buat n variasi = harga per foto x n. Sengaja perkalian polos, TANPA diskon
 *  volume: rumus di sini cuma buat DISPLAY, yang nagih beneran deduct_image_tokens. Begitu
 *  dua rumus itu beda, angka di layar bohong. Pure — dites di image-engines.test.mjs. */
export function totalCostFor(
  costs: Record<string, number>,
  model: string,
  resolution: string,
  variants: number,
): number | null {
  const unit = costFor(costs, model, resolution)
  return unit == null ? null : unit * clampVariants(variants)
}

/** Cermin clampVariants di worker/src/image-engines.ts. Ada di sini supaya label harga di
 *  Settings ga pernah nampilin angka yang bakal ditolak server. Pure — dites. */
export function clampVariants(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 4
  return Math.min(4, Math.max(1, Math.floor(n)))
}

/** Pilihan tersimpan + daftar yang enabled sekarang → pilihan yang SAH sekarang.
 *
 *  Kenapa perlu: admin bisa matiin engine kapan aja, sementara config kiosk nyimpen pilihan
 *  lama. Tanpa reconcile, dropdown nampilin "Nano Pro 4K" padahal Worker bakal nolak 403 pas
 *  tamu udah di depan kamera. Fallback ke model pertama yang enabled (urutan IMAGE_MODELS =
 *  murah duluan), resolusi termurah — bukan ke yang paling mahal.
 *
 *  Balikin null kalau ga ada satu pun engine enabled ⇒ pemanggil jatuh ke jalur lama
 *  (per-template), persis kelakuan sebelum fitur ini ada. Pure — dites. */
export function reconcileSelection(
  costs: Record<string, number>,
  savedModel?: string,
  savedResolution?: string,
): { model: ImageModelId; resolution: ImageResolution } | null {
  const avail = enabledModels(costs)
  if (avail.length === 0) return null

  const model = avail.find(m => m.id === savedModel) ?? avail[0]
  const resolution = model.resolutions.includes(savedResolution as ImageResolution)
    ? (savedResolution as ImageResolution)
    : model.resolutions[0]
  return { model: model.id, resolution }
}

// Sidecar per-gambar di put-template-here: <nama>.json di sebelah <nama>.jpg —
// cara naro prompt buat template comfy lewat folder sync, tanpa buka PB Admin.
// Contoh: canny/Cyberpunk_Costume.jpg + Cyberpunk_Costume.json
//   { "engine_type": "comfy", "positive_prompt": "...", "negative_prompt": "...", "denoise": 0.7 }
// Photo Print: layout.png + layout.json
//   { "engine_type": "print", "shot_count": 4, "print_size": "4R" }

// Engine 'api' (Nano Banana Pro): Tosari.jpg + Tosari-ref.jpg + Tosari.json
//   { "engine_type": "api", "api_model": "nano-banana-pro",
//     "reference_images": ["Tosari-ref.jpg"], "input_field": { "label": "Nama kamu" },
//     "aspect_ratio": "2:3", "positive_prompt": "... \"TOSARI {input}\" ..." }

export type SidecarInputField = { label: string }

export type TemplateSidecar = {
  engine_type?: string
  positive_prompt?: string
  negative_prompt?: string
  video_positive_prompt?: string
  video_negative_prompt?: string
  denoise?: number
  shot_count?: number
  print_size?: '4R' | '2R'
  // Engine 'api' only
  api_model?: string
  reference_images?: string[]
  input_field?: SidecarInputField
  aspect_ratio?: string
  // Frame PNG yang OTOMATIS kepasang begitu template ini dipilih — file sefolder sama
  // gambarnya (pola sama kayak reference_images). Kepake buat event korporat: tiap template
  // punya overlay judul sendiri, jadi tamu ga usah (dan ga boleh) milih frame sendiri —
  // framechooser di-skip, salah pasangan judul-divisi ga mungkin kejadian.
  // Kosong = perilaku lama: tamu milih frame di framechooser.
  frame?: string
  // UUID row `templates` di SUPABASE yang dipakai buat nagih token. Wajib buat engine 'api':
  // RPC deduct_token nerima `p_template_id uuid`, sedangkan id record PocketBase itu string
  // 15-char — dikirim apa adanya bikin RPC balas 400 dan generate mati sebelum mulai.
  // Harga tetep ditentuin Supabase, bukan file ini; yang disebut di sini cuma BARIS MANA.
  billing_id?: string
}

// engine_type di PB itu free text — typo ("pritn") bakal diem-diem jatuh ke path faceswap.
// Whitelist di trust boundary biar typo ke-drop eksplisit, bukan nyasar jadi nilai liar di PB.
const KNOWN_ENGINES = ['faceswap', 'fullbody', 'api', 'comfy', 'print']
const MAX_SHOTS = 6

// Cermin whitelist Worker. Worker tetep yang berkuasa (dia yang megang FAL key + URL asli) —
// ini cuma nyegah nilai liar nyangkut di PB dan bingungin operator pas debug.
const KNOWN_API_MODELS = ['nano-banana-pro', 'nano-banana-2']
// Enum aspect_ratio FAL nano-banana-pro/edit.
const FAL_ASPECT_RATIOS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16']
const MAX_REFERENCE_IMAGES = 3 // BG doang; foto tamu nyusul di runtime, ga dihitung di sini
const MAX_LABEL_LEN = 40
// Divalidasi bentuknya di sini biar salah-ketik ketauan pas sync, bukan pas tamu udah
// berdiri di depan booth dan RPC balas 400.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Referensi harus nama file POLOS di folder template yang sama.
 *  sync-templates baca file ini by name — tanpa guard, sidecar bisa nyuruh dia baca
 *  file mana pun di disk (.env, kunci) lalu ngirimnya ke FAL sebagai "referensi". */
function isSafeFilename(v: unknown): v is string {
  return typeof v === 'string'
    && v.length > 0
    && v.length <= 120
    && !v.includes('/')
    && !v.includes('\\')
    && !v.includes('..')
    && !/^[a-zA-Z]:/.test(v) // drive letter Windows
}

// Parser di trust boundary (file bebas diedit tangan) — field salah tipe di-DROP,
// JSON rusak → null (template tetep ke-sync sebagai faceswap biasa, bukan gagal).
export function parseSidecar(raw: string): TemplateSidecar | null {
  try {
    const obj: unknown = JSON.parse(raw)
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null
    const o = obj as Record<string, unknown>
    const out: TemplateSidecar = {}
    if (typeof o.engine_type === 'string' && KNOWN_ENGINES.includes(o.engine_type)) out.engine_type = o.engine_type
    if (typeof o.positive_prompt === 'string') out.positive_prompt = o.positive_prompt
    if (typeof o.negative_prompt === 'string') out.negative_prompt = o.negative_prompt
    if (typeof o.video_positive_prompt === 'string') out.video_positive_prompt = o.video_positive_prompt
    if (typeof o.video_negative_prompt === 'string') out.video_negative_prompt = o.video_negative_prompt
    if (typeof o.denoise === 'number' && Number.isFinite(o.denoise)) out.denoise = o.denoise
    if (typeof o.shot_count === 'number' && Number.isInteger(o.shot_count) && o.shot_count >= 1 && o.shot_count <= MAX_SHOTS) out.shot_count = o.shot_count
    if (o.print_size === '4R' || o.print_size === '2R') out.print_size = o.print_size

    // ── engine 'api' ─────────────────────────────────────────────────────────
    if (typeof o.api_model === 'string' && KNOWN_API_MODELS.includes(o.api_model)) out.api_model = o.api_model
    if (typeof o.billing_id === 'string' && UUID_RE.test(o.billing_id)) out.billing_id = o.billing_id
    if (typeof o.aspect_ratio === 'string' && FAL_ASPECT_RATIOS.includes(o.aspect_ratio)) out.aspect_ratio = o.aspect_ratio
    if (Array.isArray(o.reference_images)) {
      // Entri jelek DIBUANG satuan, bukan ngegagalin seluruh sidecar — satu typo jangan
      // bikin template ilang diam-diam dari grid.
      const refs = o.reference_images.filter(isSafeFilename).slice(0, MAX_REFERENCE_IMAGES)
      if (refs.length > 0) out.reference_images = refs
    }
    // Guard path traversal SAMA kayak reference_images: nama file ini dipakai buat baca
    // file dari folder template. Tanpa isSafeFilename, sidecar bisa nyuruh baca file mana
    // pun di disk lalu naik ke PocketBase sebagai "frame".
    if (typeof o.frame === 'string' && isSafeFilename(o.frame)) out.frame = o.frame
    if (typeof o.input_field === 'object' && o.input_field !== null && !Array.isArray(o.input_field)) {
      const label = (o.input_field as Record<string, unknown>).label
      if (typeof label === 'string' && label.trim().length > 0) {
        out.input_field = { label: label.trim().slice(0, MAX_LABEL_LEN) }
      }
    }
    return out
  } catch {
    return null
  }
}

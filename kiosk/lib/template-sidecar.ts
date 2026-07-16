// Sidecar per-gambar di put-template-here: <nama>.json di sebelah <nama>.jpg —
// cara naro prompt buat template comfy lewat folder sync, tanpa buka PB Admin.
// Contoh: canny/Cyberpunk_Costume.jpg + Cyberpunk_Costume.json
//   { "engine_type": "comfy", "positive_prompt": "...", "negative_prompt": "...", "denoise": 0.7 }
// Photo Print: layout.png + layout.json
//   { "engine_type": "print", "shot_count": 4, "print_size": "4R" }

export type TemplateSidecar = {
  engine_type?: string
  positive_prompt?: string
  negative_prompt?: string
  denoise?: number
  shot_count?: number
  print_size?: '4R' | '2R'
}

// engine_type di PB itu free text — typo ("pritn") bakal diem-diem jatuh ke path faceswap.
// Whitelist di trust boundary biar typo ke-drop eksplisit, bukan nyasar jadi nilai liar di PB.
const KNOWN_ENGINES = ['faceswap', 'fullbody', 'api', 'comfy', 'print']
const MAX_SHOTS = 6

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
    if (typeof o.denoise === 'number' && Number.isFinite(o.denoise)) out.denoise = o.denoise
    if (typeof o.shot_count === 'number' && Number.isInteger(o.shot_count) && o.shot_count >= 1 && o.shot_count <= MAX_SHOTS) out.shot_count = o.shot_count
    if (o.print_size === '4R' || o.print_size === '2R') out.print_size = o.print_size
    return out
  } catch {
    return null
  }
}

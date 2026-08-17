import type { LockReason } from './license'

export type EngineType = 'faceswap' | 'fullbody' | 'api' | 'comfy' | 'print'
export type GenderFilter = 'MAN' | 'WOMEN' | 'HIJAB' | 'ALL'

// Photo Print (non-AI). 2R selalu dicetak 2-up di kertas 4R — printer gak pernah ganti media.
export type PrintSize = '4R_PORTRAIT' | '4R_LANDSCAPE' | '2R_STRIP'

export type ComfyModelFamily = 'sd15' | 'sdxl' | 'flux'
export type ComfyControlnetMode = 'canny' | 'depth' | 'off'

// Video engine (img2vid): output image terakhir dijadikan seed ke provider video via FAL.
// Semua provider lewat satu FAL_API_KEY (Worker env) — bedanya cuma endpoint FAL per provider.
export type VideoProvider =
  | 'SEEDANCE' | 'LTX' | 'WAN' | 'VEO' | 'KLING'
  | 'PIXVERSE' | 'HAPPYHORSE' | 'VIDU'

export type VideoPromptChoice = {
  id: string
  title: string
  positive_prompt: string
  negative_prompt: string
}

export type Template = {
  id: string
  name: string
  category: string
  gender_filter: GenderFilter
  engine_type: EngineType
  token_cost: number
  thumbnail_url: string | null
  positive_prompt: string | null
  negative_prompt: string | null
  api_endpoint: string | null
  video_endpoint: string | null
  video_positive_prompt: string | null
  video_negative_prompt: string | null
  denoise?: number | null // override kreatif per-template; null = pakai default global settings
  // Engine 'print' only — semua null/undefined buat engine lain
  shot_count?: number | null   // jumlah jepretan per sesi; null ⇒ 4
  print_size?: PrintSize | null // null ⇒ '4R_PORTRAIT'
  overlay_url?: string | null  // PNG transparan (alpha utuh) dibakar di atas slot foto
  overlay_right_url?: string | null // PNG transparan untuk sisi kanan 2R_STRIP
  layout_config?: { slots: { x: number; y: number; w: number; h: number; r?: number }[] } | null
  // Engine 'api' only (Nano Banana Pro) — semua null/undefined buat engine lain
  // CATATAN: sejak model jadi milik server, field ini TIDAK ikut ke /api/generate. Yang
  // dipakai Worker = payload_json.api_model di row Supabase (sepaket sama token_cost yang
  // nagih). Di sini tinggal keterangan template doang — ngubahnya gak ngubah apa pun.
  api_model?: string | null
  reference_urls?: string[]      // gambar BG dari PB, ikut ke image_urls sebelum foto tamu
  input_label?: string | null    // ada ⇒ screen nameinput muncul; isinya nempel di {input}
  aspect_ratio?: string | null   // enum FAL; null ⇒ biarin FAL yang mutusin
  billing_id?: string | null     // UUID row templates SUPABASE buat nagih token (id PB bukan uuid)
}

export type Face = {
  id: string
  x: number
  y: number
  w: number
  h: number
  cropUrl?: string
}

export type FaceSlot = {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export type FaceAssignments = Record<string, string>

export type Frame = {
  id: string
  url: string
  name: string // pairing key: portrait "neon" <-> landscape "neon" (case-insensitive)
}

export type GenerationSource = 'LOCAL' | 'CLOUD' | 'fal'

// One AI result from the multi-template swap loop. Carries everything the frame→preview flow
// needs so SHOW_PREVIEW can hand all results straight into the preview grid (no chooser step).
export type SwapResult = {
  templateId: string
  aiUrl: string
  originalUrl: string
  sourceUrl?: string
  rawAiUrl?: string
  base?: string
  processingSec?: number
}

export type VideoDefaults = {
  default_positive_prompt: string
  default_negative_prompt: string
  max_duration_sec: number
}

export type TemplateSource = 'pocketbase' | 'json'

export type Ai4ROrientation = 'LANDSCAPE' | 'PORTRAIT'
export type Ai4RLayout = 'GRID_4' | 'TRIO_3' | 'GRID_3' | 'SPLIT_2' | 'SINGLE_1'

export type KioskConfig = {
  brand_color: string
  logo_url?: string
  bg_url?: string
  event_name: string
  generation_source: GenerationSource
  templates: Template[]
  frames: Frame[]
  enable_email: boolean
  enable_print: boolean
  enable_video: boolean
  enable_gallery: boolean
  video_defaults: VideoDefaults
  video_prompt_choices?: VideoPromptChoice[]
  engine_mode?: string
  camera_source?: string
  api_model?: string
  max_templates?: number          // VIP multi-template: 1 (default) — 4. undefined ⇒ 1.
  original_captures?: number      // Jumlah foto asli per tamu (1–4). undefined/1 ⇒ 1. Foto #1 diproses AI, sisanya masuk ke 2-Strip pool.
  // Strip 2R dari hasil AI: tamu nyusun sendiri hasil AI + Ori jadi strip pas tombol Cetak 2-Strip.
  // Nol token — cuma nyusun ulang aset yang udah jadi. 0/undefined ⇒ tombolnya ga muncul sama sekali.
  ai_strip_slots?: number         // batas atas slot (2–4). Slot nyata = min(ini, isi kolam).
  ai_strip_overlay_url?: string   // overlay PNG 2R strip kiri / default (600×1800) — dibakar di sheet.
  ai_strip_overlay_right_url?: string // overlay PNG 2R strip kanan (600×1800) jika desain kanan beda dari kiri.
  ai_strip_custom_slots?: { slots: { x: number; y: number; w: number; h: number; r?: number }[] } | null // Custom slots dari LayoutDesigner
  ai_4r_orientation?: Ai4ROrientation // orientasi 4R ('LANDSCAPE' = 1800×1200, 'PORTRAIT' = 1200×1800). Default 'LANDSCAPE'.
  ai_4r_overlay_url?: string      // overlay PNG 4R (1800×1200 Landscape atau 1200×1800 Portrait) — dibakar SEKALI di sheet 4R.
  ai_4r_layout?: Ai4RLayout       // Layout preset 4R (GRID_4, TRIO_3, GRID_3, SPLIT_2, SINGLE_1).
  ai_4r_custom_slots?: { slots: { x: number; y: number; w: number; h: number; r?: number }[] } | null // Custom slots 4R dari LayoutDesigner
  require_4r_overlay?: boolean    // Jika true, mode 4R wajib memiliki overlay 4R terpasang.
  enable_magic_catcher?: boolean  // reaction cam toggle. undefined ⇒ false.
  magic_catcher_device_id?: string // kamera reaction cam (deviceId getUserMedia). ''/undefined ⇒ default.
  magic_catcher_duration_sec?: number // durasi max rekam (detik). undefined ⇒ 15.
  magic_catcher_audio?: boolean   // rekam audio (consent via disclaimer idle). undefined ⇒ false.
  // Engine comfy (per-template engine_type 'comfy') — global knobs, persist di settings.json
  comfy_model_family?: ComfyModelFamily
  comfy_checkpoint?: string
  comfy_controlnet?: ComfyControlnetMode
  comfy_denoise?: number        // 0.10–0.95 — kekuatan restyle img2img
  comfy_face_lock?: boolean     // ReActor swap muka tamu balik ke hasil
  comfy_sampler?: string        // override sampler; '' / undefined = default per family
  comfy_scheduler?: string      // override scheduler; '' / undefined = default per family
  comfy_cfg?: string            // override CFG ('3'..'10'); '' / undefined = default; flux dikunci 1.0
  comfy_steps?: string          // override steps ('15'|'20'|'25'|'30'); '' / undefined = default; flux dikunci 20
  comfy_cn_strength?: string    // override ControlNet strength ('0.3'..'1.0'); '' / undefined = default 0.8
  // Fullbody engine (ComfyUI) — operator toggle di Settings, LAUNCHER gak auto-start lagi.
  // undefined/false ⇒ mati, template engine_type='comfy' gak bisa jalan sampai dinyalain.
  enable_fullbody_engine?: boolean
  // Video engine (img2vid) — routing di Worker. undefined ⇒ OFF.
  enable_video_engine?: boolean
  video_provider?: VideoProvider  // dipakai kalau enable_video_engine true. undefined ⇒ PIXVERSE (HPP termurah).
  video_resolution?: '720p' | '1080p'  // undefined ⇒ 720p (hemat). 1080p = tarif cost_1080 (kalau provider punya).
  video_duration?: number  // 5 | 8 detik (operator pilih). undefined ⇒ pin default provider (8). Charge flat.
  // Image engine (engine_type 'api') — operator milih model + resolusi global, kayak video.
  // Dua-duanya undefined ⇒ jalur LAMA per-template (deduct_token + payload_json), persis
  // kelakuan sebelum fitur ini. Key registry-nya dirakit di lib/image-engines.ts, harga +
  // enable/disable dari admin lewat handshake (image_costs). Worker fail-closed kalau ngawur.
  image_model?: string       // 'nano-banana-2-google' | 'nano-banana-pro-google' | 'nano-banana-google'
  image_resolution?: string  // '1K' | '2K' | '4K' — cuma yang enabled di admin yang muncul
  // Jumlah variasi AI per jepretan (1-4). Harga di admin = PER FOTO, jadi 4 varian = 4x token.
  // Kiosk cuma nyebut angkanya; yang ngali harga & clamp tetep Worker + RPC deduct_image_tokens.
  // undefined ⇒ 4 (kelakuan lama sebelum dropdown ini ada).
  image_variants?: number
  template_local?: string
  template_source?: TemplateSource
  pocketbase_url?: string
  output_dir?: string
  kiosk_name?: string    // dari DB (kiosks.name) — read-only di Settings
  kiosk_no?: number      // dari DB (kiosks.kiosk_no) — read-only di Settings
  remaining_sec?: number    // ponytail: from heartbeat — undefined = licensing bypassed/dev
  pause_quota_sec?: number  // 50% dari total sewa — kuota jeda maksimal
  pause_used_sec?: number   // total detik pause yang sudah terpakai (snapshot dari heartbeat)
  licensed?: boolean     // server verdict: session aktif + belum expired
  bypassed?: boolean     // true = godmode — timer/pause/watermark unlimited
  has_secret?: boolean   // secret tersimpan di config
  secret_hint?: string   // full secret — dikirim ke Settings panel untuk masking + reveal client-side
  lock_message?: string  // custom message dari admin saat force_locked
  locale?: Locale
}

// Display languages: plain EN/ID + SEA (MS/TH/VI/TL) + KO/JA/NL/ZH/AR + Dark Myth variants (oracle tone on titles/subtitles).
export type Locale = 'en' | 'id' | 'ms' | 'th' | 'vi' | 'tl' | 'ko' | 'ja' | 'nl' | 'zh' | 'ar' | 'myth-en' | 'myth-id'

export type KioskState =
  | { screen: 'idle' }
  | { screen: 'consent' }
  | { screen: 'liveview' }
  | { screen: 'category'; imageUrl: string; selected?: Template[]; shots?: string[] }
  | { screen: 'template'; selected: Template[]; category: string; imageUrl: string; shots?: string[] }
  | { screen: 'faceassign'; imageUrl: string; templates: Template[]; category: string; faces: Face[]; currentTemplateIndex: number; templateSlots: FaceSlot[]; assignments: FaceAssignments; allMappings: (number | null)[][]; shots?: string[] }
  // Photo Print: layout dipilih dulu → jepret N kali di sini (kebalikan flow AI yang foto duluan)
  | { screen: 'multicapture'; template: Template; shots: string[] }
  // Engine 'api' dengan input_label: tamu ngetik nama SEBELUM processing (nilainya masuk prompt
  // berbayar, jadi harus udah pasti pas /api/generate ditembak). Template tanpa input_label lewat.
  | { screen: 'nameinput'; imageUrl: string; templates: Template[]; category: string; shots?: string[] }
  // faceMapping[i] = index selfie face (L-R) buat slot template ke-i (L-R). null = slot dilewat.
  // templates: 1 (biasa) atau 2-4 (VIP multi). Swap sequential, 1 selfie mapping dipakai semua.
  // shots: engine 'print' / multi-original AI — N jepretan buat compose layout, imageUrl = shots[0]
  // userInput = teks tamu yang udah disanitasi (lihat lib/prompt-input.ts), disuntik ke {input}
  | { screen: 'processing'; progress: number; step: 1 | 2 | 3; imageUrl: string; templates: Template[]; faceMappings?: (number | null)[][]; shots?: string[]; assignments?: FaceAssignments; userInput?: string }
  // sourceUrl = selfie bersih (pre-watermark) buat BACK/re-edit + upload _A. originalUrl bisa
  // ke-burn watermark (freemium), jangan dipakai sbg sumber re-detect/upload.
  // rawAiUrl = hasil AI bersih (pre-watermark) buat upload _B. base = seq key dari finalizeLocal.
  // framechooser = pilih frame dulu (cycling), NEXT bawa selectedFrame ke preview. No upload/print di sini.
  | { screen: 'framechooser'; aiUrl: string; originalUrl: string; sourceUrl?: string; rawAiUrl?: string; base?: string; processingSec?: number; videoUrl?: string; templateId?: string; allResults?: SwapResult[]; shots?: string[] }
  // printSize set = sesi Photo Print (video tab & toggle AI/Asli disembunyiin, BACK balik ke template)
  | { screen: 'preview'; aiUrl: string; originalUrl: string; sourceUrl?: string; rawAiUrl?: string; base?: string; processingSec?: number; selectedFrame: Frame | null; videoUrl?: string; templateId?: string; printSize?: PrintSize; allResults?: SwapResult[]; shots?: string[] }
  // aiUrl/originalUrl = display (burned+framed). uploadAiUrl/uploadOriginalUrl = raw+framed → R2.
  | { screen: 'delivery'; aiUrl: string; originalUrl: string; uploadAiUrl: string; uploadOriginalUrl: string; base?: string; processingSec?: number; r2OriginalUrl?: string; r2AiUrl?: string }
  | { screen: 'force_locked'; reason?: LockReason; message?: string }

export type KioskAction =
  | { type: 'START' }
  | { type: 'CONSENT_GIVEN'; print?: boolean } // print = mode print_local → skip liveview+category, langsung template
  | { type: 'CAPTURE'; imageUrl: string; shots?: string[] }
  | { type: 'START_CAPTURE_LOOP' } // template (engine 'print') → multicapture
  | { type: 'SHOT_TAKEN'; imageUrl: string }
  | { type: 'POP_LAST_SHOT' }
  | { type: 'RETAKE_SHOTS' } // reset semua jepretan, ulang sequence
  | { type: 'SELECT_CATEGORY'; category: string }
  | { type: 'SELECT_TEMPLATE'; template: Template; maxTemplates: number }
  | { type: 'CONFIRM_TEMPLATE' }
  | { type: 'GO_FACE_ASSIGN'; faces: Face[]; templateSlots: FaceSlot[] }
  | { type: 'ASSIGN_FACE'; faceId: string; slotId: string }
  | { type: 'UNASSIGN_FACE'; faceId: string }
  | { type: 'NEXT_FACE_ASSIGN'; mappings: (number | null)[] }
  | { type: 'GO_NAME_INPUT' } // template (engine 'api' + input_label) → nameinput
  | { type: 'START_PROCESSING'; faceMappings?: (number | null)[][]; userInput?: string }
  | { type: 'SET_PROGRESS'; progress: number }
  // direct = skip framechooser langsung ke preview (Photo Print: overlay udah dibakar, frame dobel haram)
  | { type: 'SHOW_PREVIEW'; aiUrl: string; originalUrl: string; sourceUrl?: string; rawAiUrl?: string; base?: string; processingSec?: number; videoUrl?: string; direct?: boolean; printSize?: PrintSize; templateId?: string; allResults?: SwapResult[] }
  | { type: 'GO_DELIVERY'; aiUrl: string; originalUrl: string; uploadAiUrl: string; uploadOriginalUrl: string }
  | { type: 'SELECT_FRAME'; frame: Frame | null }
  | { type: 'CONFIRM_FRAME'; frame: Frame | null } // framechooser NEXT → preview bawa frame kepilih
  | { type: 'BACK' }
  | { type: 'RESET' }
  | { type: 'SET_R2_URLS'; r2OriginalUrl: string; r2AiUrl: string }
  | { type: 'SET_STATE'; state: KioskState } // ponytail: dev-only keyboard nav
  | { type: 'FORCE_LOCKED'; reason?: LockReason; message?: string }

import type { LockReason } from './license'

export type EngineType = 'faceswap' | 'fullbody' | 'api'
export type GenderFilter = 'MAN' | 'WOMEN' | 'HIJAB' | 'ALL'

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
}

export type GenerationSource = 'LOCAL' | 'CLOUD' | 'fal'

export type VideoDefaults = {
  default_positive_prompt: string
  default_negative_prompt: string
  max_duration_sec: number
}

export type TemplateSource = 'pocketbase' | 'json'

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
  engine_mode?: string
  camera_source?: string
  api_model?: string
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

// 4 display languages: plain EN/ID + Dark Myth variants (oracle tone on titles/subtitles).
export type Locale = 'en' | 'id' | 'myth-en' | 'myth-id'

export type KioskState =
  | { screen: 'idle' }
  | { screen: 'consent' }
  | { screen: 'liveview' }
  | { screen: 'category'; imageUrl: string }
  | { screen: 'template'; selected: Template | null; category: string; imageUrl: string }
  | { screen: 'faceassign'; imageUrl: string; template: Template | null; category: string; faces: Face[]; templateSlots: FaceSlot[]; assignments: FaceAssignments }
  | { screen: 'processing'; progress: number; step: 1 | 2 | 3; imageUrl: string; template: Template; assignments: FaceAssignments }
  | { screen: 'preview'; aiUrl: string; originalUrl: string; selectedFrame: Frame | null; r2OriginalUrl?: string; r2AiUrl?: string }
  | { screen: 'force_locked'; reason?: LockReason; message?: string }

export type KioskAction =
  | { type: 'START' }
  | { type: 'CONSENT_GIVEN' }
  | { type: 'CAPTURE'; imageUrl: string }
  | { type: 'SELECT_CATEGORY'; category: string }
  | { type: 'SELECT_TEMPLATE'; template: Template }
  | { type: 'CONFIRM_TEMPLATE' }
  | { type: 'GO_FACE_ASSIGN'; faces: Face[]; templateSlots: FaceSlot[] }
  | { type: 'ASSIGN_FACE'; faceId: string; slotId: string }
  | { type: 'UNASSIGN_FACE'; faceId: string }
  | { type: 'START_PROCESSING' }
  | { type: 'SET_PROGRESS'; progress: number }
  | { type: 'SHOW_PREVIEW'; aiUrl: string; originalUrl: string }
  | { type: 'SELECT_FRAME'; frame: Frame | null }
  | { type: 'BACK' }
  | { type: 'RESET' }
  | { type: 'SET_R2_URLS'; r2OriginalUrl: string; r2AiUrl: string }
  | { type: 'SET_STATE'; state: KioskState } // ponytail: dev-only keyboard nav
  | { type: 'FORCE_LOCKED'; reason?: LockReason; message?: string }

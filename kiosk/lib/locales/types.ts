export interface Translations {
  // ── IdleScreen ──────────────────────────────────────────────────────────────
  idle_title: string
  idle_subtitle: string
  idle_next: string
  legal_recording_notice: string  // Magic Catcher legal disclaimer, shown under Start button

  // ── CategoryScreen ───────────────────────────────────────────────────────────
  category_title: string
  category_subtitle: string
  category_empty: string
  category_skip: string

  // ── TemplateScreen ───────────────────────────────────────────────────────────
  template_title: string
  template_subtitle: string
  template_multi_counter: string  // "selected" — counter suffix (N/M selected)


  // ── Shared navigation buttons ────────────────────────────────────────────────
  nav_back: string      // "← Previous"
  nav_next: string      // "Next →"

  // ── FaceAssignScreen ─────────────────────────────────────────────────────────
  faceassign_title: string
  faceassign_subtitle: string
  faceassign_detecting: string
  faceassign_no_faces_in_template: string
  faceassign_person_label: string  // e.g. "Person" (number appended by code)

  // ── LiveViewScreen ───────────────────────────────────────────────────────────
  liveview_title: string
  liveview_subtitle: string
  liveview_loading_camera: string
  liveview_smile: string
  liveview_browse: string
  liveview_capture: string
  // Camera error state
  liveview_error_title: string
  liveview_error_body: string        // generic camera access error
  liveview_error_browse: string
  liveview_error_retry: string
  // aria-label for rotate button
  liveview_rotate_aria: string

  // ── MultiCaptureScreen (Photo Print) ────────────────────────────────────────
  multicapture_title: string
  multicapture_subtitle: string
  multicapture_counter: string      // e.g. "Foto" → "Foto 2/4" (angka dari kode)
  multicapture_get_ready: string    // jeda antar shot — ganti pose
  multicapture_start: string
  multicapture_review_title: string // judul review grid setelah semua shot
  multicapture_retake: string

  // ── NameInputScreen ──────────────────────────────────────────────────────────
  // Engine 'api': teks tamu yang disuntik ke {input} di prompt. Judul screen pakai
  // input_label dari template (per-template), jadi ga ada key buat itu di sini.
  nameinput_subtitle: string
  nameinput_placeholder: string
  nameinput_hint: string          // wajib: kasih tau tamu namanya KELIHATAN di cetakan
  nameinput_back: string
  nameinput_next: string
  nameinput_skip: string          // nama opsional — label tombol pas field masih kosong

  // ── ProcessingScreen ─────────────────────────────────────────────────────────
  processing_title: string
  processing_subtitle: string
  // Error / timeout state
  processing_error_title: string
  processing_error_subtitle: string
  processing_start_over: string
  processing_try_again: string
  processing_multi: string       // "Processing" — prefix for "N/M…" multi-template progress
  // Rotating fun-facts copy (array — cycled every 4 s)
  processing_copy: string[]

  // ── PreviewScreen ────────────────────────────────────────────────────────────
  preview_title: string
  preview_subtitle: string
  // Tap hint badges
  preview_tap_compare: string     // "Tap to compare"
  preview_tap_see_ai: string      // "Tap to see AI"
  // Generating video placeholder
  preview_generating: string
  // Video progress label (% appended by code)
  preview_generating_video: string
  // Print panel
  preview_print_qty_label: string
  preview_print_cancel: string
  preview_printing: string        // "Printing..."
  preview_print_btn: string       // "Print {n}x"
  // Email panel
  preview_email_label: string
  preview_email_invalid: string
  preview_email_cancel: string
  preview_email_send: string
  preview_email_placeholder: string
  // Email sent popup
  preview_email_sent_title: string
  preview_email_sent_body: string
  // Make Video confirm dialog
  preview_video_dialog_title: string
  preview_video_dialog_body: string
  preview_video_dialog_ok: string
  preview_video_dialog_cancel: string
  preview_video_cost_note: string   // "Cost Token" sub-label
  // Main action buttons
  preview_btn_print: string
  preview_btn_strip: string
  preview_btn_email: string

  // ── StripComposer (susun strip 2R dari hasil AI) ─────────────────────────────
  strip_title: string
  strip_hint: string
  strip_hint_full: string
  strip_slot_empty: string        // aria-label slot kosong
  strip_slot_clear: string        // aria-label slot terisi (tap = buang)
  strip_label_original: string
  strip_label_ai: string
  strip_two_copies: string        // printer motong jadi 2 strip identik — tamu wajib dikasih tau
  strip_print_failed: string
  strip_print_btn: string
  strip_title_4r: string
  strip_print_4r: string
  strip_locked_4r: string
  strip_tip: string
  strip_fit_width: string
  strip_fit_height: string
  preview_btn_make_video: string
  preview_btn_video_ready: string
  preview_btn_rechoose: string
  remap_edit_face: string              // tombol "Edit Wajah" di foto AI yang dibesarkan
  remap_title: string
  remap_person: string                 // "{n}" = nomor orang
  remap_detecting: string
  remap_no_face: string
  remap_cancel: string
  remap_confirm: string
  remap_working: string
  remap_failed: string
  remap_undo: string
  remap_keep: string
  preview_btn_restart: string

  // ── DeliveryScreen ───────────────────────────────────────────────────────────
  delivery_title: string
  delivery_subtitle: string
  delivery_qr_uploading: string   // spinner label while R2 upload in-flight
  delivery_qr_retry: string       // retry button after failed upload

  // ── ConsentScreen ────────────────────────────────────────────────────────────
  consent_title: string
  consent_subtitle: string
  consent_minor: string
  consent_back: string
  consent_agree: string
  // Privacy policy document
  consent_policy_header: string          // "KEBIJAKAN PRIVASI — Terakhir diperbarui: 28 Juni 2026"
  consent_policy_consent_heading: string // "Persetujuan Pemrosesan Foto"
  consent_policy_consent_intro: string
  consent_policy_consent_items: string[]
  consent_policy_consent_reject: string
  consent_policy_consent_minor: string
  consent_policy_s1_heading: string
  consent_policy_s1_body: string
  consent_policy_s2_heading: string
  consent_policy_s2_items: string[]
  consent_policy_s2_footer: string
  consent_policy_s3_heading: string
  consent_policy_s3_intro: string
  consent_policy_s3_items: string[]
  consent_policy_s4_heading: string
  consent_policy_s4_body: string
  consent_policy_s5_heading: string
  consent_policy_s5_body: string
  consent_policy_s6_heading: string
  consent_policy_s6_intro: string
  consent_policy_s7_heading: string
  consent_policy_s7_items: string[]
  consent_policy_s7_footer: string
  consent_policy_s8_heading: string
  consent_policy_s8_body: string
  consent_policy_s9_heading: string
  consent_policy_s9_body: string
  consent_policy_s10_heading: string
  consent_policy_s10_body: string
  consent_policy_s11_heading: string
  consent_policy_s11_company: string
  consent_policy_s11_email: string
  consent_policy_s11_wa: string
  consent_policy_footer: string     // "epicyoung software"

  // ── ExpiredScreen ────────────────────────────────────────────────────────────
  expired_title: string
  expired_subtitle: string
  expired_contact: string

  // ── LockScreen (per reason) ───────────────────────────────────────────────────
  lock_needs_activation_title: string
  lock_needs_activation_sub: string
  lock_needs_reconfirm_title: string
  lock_needs_reconfirm_sub: string
  lock_expired_title: string
  lock_expired_sub: string
  lock_disabled_title: string
  lock_disabled_sub: string
  lock_force_locked_title: string
  lock_force_locked_sub: string
  lock_no_secret: string

  // ── SettingsPanel (operator panel) ───────────────────────────────────────────
  set_header: string
  set_close_aria: string
  set_done: string
  set_saving: string
  set_save_error: string
  // License section
  set_secret_label: string
  set_secret_installed: string        // "● Installed — active immediately, no restart"
  set_secret_empty_hint: string       // "Not set — ask admin"
  set_secret_state_active: string
  set_secret_state_expired: string
  set_secret_placeholder_empty: string // shown in masked box when no secret
  set_secret_hold_reveal: string       // title on eye button
  set_secret_change: string            // "Change"
  set_secret_save: string
  set_secret_saved: string
  set_secret_cancel: string
  // Timer + pause
  set_time_remaining: string
  set_resume: string
  set_resume_need_conn: string         // "Needs connection" (button)
  set_pause_disabled: string           // "Pause disabled"
  set_pause: string
  set_resume_failed: string            // "Resume failed — needs internet."
  // Pause quota
  set_pause_quota: string
  set_pause_quota_hint: string         // "50% of total rental · active while paused"
  set_pause_quota_exhausted_badge: string // "Used up"
  set_pause_quota_exhausted_note: string
  set_pause_quota_low_note: string
  // Identity
  set_kiosk_name: string
  set_kiosk_no: string
  // Event
  set_event_name: string
  // Language
  set_display_language: string
  // Output
  set_folder: string
  set_pb_data: string
  set_pb_data_note: string             // "Read-only — managed by PocketBase"
  // Templates
  set_source: string
  set_pb_url: string
  set_status: string
  set_open_folder: string              // "📁 Open Folder"
  set_fetch_loading: string
  set_fetch_ok: string
  set_fetch_failed: string
  set_fetch_idle: string
  set_import_hint_pre: string
  set_import_hint_post: string
  set_json_note: string
  // Status badge
  set_badge_checking: string
  set_badge_connected: string
  set_badge_offline: string
  // Engine
  set_mode: string
  set_api_model: string
  // VIP multi-template + Magic Catcher
  set_original_captures: string
  set_original_captures_hint: string
  set_max_templates: string
  set_max_templates_hint: string
  set_ai_strip: string
  set_ai_strip_off: string
  set_ai_strip_hint: string
  set_ai_strip_overlay_hint: string
  set_magic_catcher: string
  set_magic_catcher_hint: string
  // Opsional — baru ada di en/id, locale lain fallback ke en (resolveT). Optional biar 9 locale
  // lain ga wajib nambahin bareng.
  set_magic_camera?: string
  set_magic_duration?: string
  set_magic_audio?: string
  // Camera
  // System / Update
  set_version_label: string
  set_update_check: string
  set_update_checking: string
  set_update_available: string
  set_update_uptodate: string
  set_update_pulling: string
  set_update_ok: string
  set_update_failed: string
  set_update_restart_note: string
  set_update_disabled_note: string
  // Branding
  set_logo: string
  set_logo_hint: string
  set_bg: string
  set_bg_hint: string
  set_upload: string
  set_change: string
  set_remove: string
  set_frames: string
  set_frames_hint: string              // "Transparent PNG · 2:3 ratio · max 10"
  set_frames_loading: string
  set_frames_empty: string
  set_bg_effects: string
  set_bg_effects_hint: string          // "Off = solid color, blob removed"
  set_bg_color: string

  // ── SettingsPanel — accordion group titles ───────────────────────────────────
  set_group_event: string              // "Event & Identity"
  set_group_branding: string           // "Creative & Branding"
  set_group_engine: string             // "AI Engine & Templates"
  set_group_hardware: string           // "Hardware & System"

  // ── SettingsPanel — engine/stylize section ───────────────────────────────────
  set_token_balance: string            // "Token Balance"
  set_token_unit: string               // "token" (suffix after number)
  set_api_model_hint: string           // per-photo token cost note
  set_stylize_offline: string          // "Stylize server offline — saved setting still used"
  set_model_family: string             // "Model family"
  set_checkpoint: string               // "Checkpoint"
  set_controlnet: string               // "ControlNet"
  set_controlnet_hint: string
  set_controlnet_strength: string      // "ControlNet strength"
  set_controlnet_strength_hint: string
  set_face_lock: string                // "Face lock"
  set_flux_locked_note: string         // Flux fixed-recipe note
  set_sampler: string                  // "Sampler"
  set_scheduler: string                // "Scheduler"
  set_cfg: string                      // "CFG (prompt fidelity)"
  set_cfg_hint: string
  set_steps: string                    // "Steps (smoothness)"
  set_steps_hint: string
  set_denoise: string                  // "Denoise (default)"
  set_denoise_hint: string             // "template can override"

  // ── SettingsPanel — video engine section ─────────────────────────────────────
  set_fullbody_engine: string          // "Fullbody Engine (ComfyUI)"
  set_fullbody_hint: string            // "Nyalakan sebelum jual paket Fullbody. VRAM idle kalau mati."
  set_fullbody_starting: string        // "(menyalakan…)"
  set_fullbody_stopping: string        // "(mematikan…)"
  set_fullbody_start_failed: string    // "Gagal menyalakan ComfyUI"
  set_fullbody_stop_failed: string     // "Gagal mematikan ComfyUI"
  set_video_engine: string             // "Enable Video Engine (img2vid)"
  set_video_locked_badge: string       // "LOCKED"
  set_video_need_rental: string        // needs active rental note
  set_video_locked_note: string        // feature locked note
  set_video_enabled_note: string       // last photo animated note
  set_image_model: string              // "AI Photo Model" — engine API only
  set_image_model_hint: string
  set_image_resolution: string         // "Photo Resolution"
  set_image_resolution_hint_cost: string // "{res} runs {n} token per photo" — {res}/{n} via replace
  set_image_resolution_hint: string
  set_image_variants: string           // "AI Results per Shot" — jumlah variasi 1-4
  set_image_variants_hint: string
  set_image_variants_hint_cost: string // "{n} versions — {total} token, {unit} each" — 3 placeholder
  set_image_res_default: string        // label resolusi buat model Fal (ga punya param resolusi)
  set_video_provider: string           // "Select Video Provider"
  set_video_provider_hint_cost: string // "Each video (8s, {res}) burns {n} token…" — {res}/{n} via replace
  set_video_provider_hint_disabled: string
  set_video_provider_hint_online: string
  set_video_resolution: string         // "Video Resolution"
  set_video_res_hint_ltx: string
  set_video_res_hint_no1080: string
  set_video_res_hint_default: string
  set_video_duration: string           // "Video Duration"
  set_video_dur_hint_ltx: string
  set_video_dur_hint_default: string
  set_video_dur_5s: string             // "5 seconds"
  set_video_dur_5s_ltx: string         // "5 seconds (LTX ✕)"
  set_video_dur_8s: string             // "8 seconds"
  set_video_prompt_designer: string    // "Video Prompt Engineer"
  set_video_prompt_designer_hint: string
  set_video_prompt_designer_btn: string // "Setup Prompts"
  set_verify_checking: string          // "Verifying key…"
  set_verify_valid: string             // "✓ Key valid — restarting in {n}…"
  set_verify_expired: string
  set_verify_invalid: string
  set_verify_offline: string
  set_secret_verify_btn_checking: string // "Check…"
  set_status_no_watermark: string      // "NO WATERMARK"
  set_status_qr_active: string         // "QR ACTIVE"
  set_magic_catcher_webcam_only: string // "Only available in Webcam (getUserMedia) mode."
  set_restart_booth_title: string      // restart booth tooltip
  set_restart_booth_label?: string
  set_restart_booth_hint?: string
  set_restart_booth_btn?: string
  set_restart_booth_running?: string

  // ── LocalTemplateManager (Photo Print) ───────────────────────────────────────
  ltm_loading: string                  // "Loading…"
  ltm_section_kicker: string           // "Photo Print"
  ltm_section_title: string            // "Local Print Templates"
  ltm_add_overlay: string              // "+ Add Overlay"
  ltm_uploading: string                // "Uploading…"
  ltm_upload_failed: string            // alert on upload fail
  ltm_empty_title: string              // "No print templates yet"
  ltm_empty_body: string               // "Upload a transparent PNG overlay to create one."
  ltm_empty_spec: string               // canvas spec line
  ltm_name: string                     // "Name"
  ltm_step1: string                    // "Step 1 — Print Style"
  ltm_orientation: string              // "Orientation of Camera"
  ltm_step2: string                    // "Step 2 — Number of Shots"
  ltm_shots_suffix: string             // "Shot"/"Shots" — code adds count+plural
  ltm_layout_studio: string            // "Layout Studio"
  ltm_delete: string                   // "Delete"
  ltm_style_4r_label: string           // "4R Print"
  ltm_style_4r_desc: string
  ltm_style_2stripe_label: string      // "2 Stripe"
  ltm_style_2stripe_desc: string
  ltm_default_name: string             // "Print Template" (auto name prefix)

  // ── VideoPromptManager ───────────────────────────────────────────────────────
  vpm_title: string                    // "Video Prompt Engineer"
  vpm_subtitle: string
  vpm_cancel: string                   // "Cancel"
  vpm_save: string                     // "Save Configuration"
  vpm_choice_label: string             // "Choice" — code appends #n
  vpm_remove: string                   // "Remove"
  vpm_field_title: string              // "Label / Button Title"
  vpm_field_title_ph: string           // placeholder
  vpm_field_positive: string           // "Positive Prompt (Motion Style)"
  vpm_field_positive_ph: string
  vpm_field_negative: string           // "Negative Prompt (Anti-Parallax etc.)"
  vpm_field_negative_ph: string
  vpm_add: string                      // "Add Prompt Choice"
  vpm_new_choice_title: string         // default title for a new choice
}

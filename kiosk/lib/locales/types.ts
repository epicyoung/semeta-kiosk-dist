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
  preview_btn_email: string
  preview_btn_make_video: string
  preview_btn_video_ready: string
  preview_btn_rechoose: string
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
  set_max_templates: string
  set_max_templates_hint: string
  set_magic_catcher: string
  set_magic_catcher_hint: string
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
}

import type { KioskState, KioskAction } from './types'

export const initialState: KioskState = { screen: 'idle' }

export function kioskReducer(state: KioskState, action: KioskAction): KioskState {
  switch (action.type) {
    case 'START':
      return { screen: 'consent' }

    case 'CONSENT_GIVEN':
      if (state.screen !== 'consent') return state
      // Photo Print: pilih layout DULU baru foto — skip liveview+category (punya flow AI).
      // imageUrl '' + category '' = penanda flow print di screen template (BACK → idle).
      if (action.print) return { screen: 'template', imageUrl: '', category: '', selected: [] }
      return { screen: 'liveview' }

    case 'CAPTURE':
      if (state.screen !== 'liveview') return state
      return { screen: 'category', imageUrl: action.imageUrl }

    case 'SELECT_CATEGORY':
      if (state.screen !== 'category') return state
      return { screen: 'template', imageUrl: state.imageUrl, category: action.category, selected: state.selected || [] }

    case 'SELECT_TEMPLATE': {
      if (state.screen !== 'template') return state
      const exists = state.selected.some(t => t.id === action.template.id)
      if (exists) return { ...state, selected: state.selected.filter(t => t.id !== action.template.id) }
      // maxTemplates<=1 → single-select replace (backward-compat). else append kalau masih muat.
      if (action.maxTemplates <= 1) return { ...state, selected: [action.template] }
      if (state.selected.length >= action.maxTemplates) return state // penuh → no-op
      return { ...state, selected: [...state.selected, action.template] }
    }

    case 'CONFIRM_TEMPLATE':
      if (state.screen !== 'template' || state.selected.length === 0) return state
      // Flow print (imageUrl '' — belum ada selfie): FaceAssign gak punya bahan → block.
      // Kejadian cuma kalau print_local nyala tanpa template print (fallback dummy faceswap).
      if (state.imageUrl === '') return state
      return { screen: 'faceassign', imageUrl: state.imageUrl, category: state.category, templates: state.selected, faces: [], currentTemplateIndex: 0, templateSlots: [], assignments: {}, allMappings: [] }

    case 'START_CAPTURE_LOOP':
      // Guard engine_type kayak comfy (defense-in-depth): cuma template print yang boleh ke capture loop.
      if (state.screen !== 'template' || state.selected.length !== 1 || state.selected[0].engine_type !== 'print') return state
      return { screen: 'multicapture', template: state.selected[0], shots: [] }

    case 'SHOT_TAKEN': {
      if (state.screen !== 'multicapture') return state
      const target = state.template.shot_count ?? 4
      if (state.shots.length >= target) return state // udah penuh → no-op
      return { ...state, shots: [...state.shots, action.imageUrl] }
    }

    case 'RETAKE_SHOTS':
      if (state.screen !== 'multicapture') return state
      return { ...state, shots: [] }

    case 'PICK_RESULT': {
      // Multi-template: tamu pilih 1 hasil di grid → collapse ke framechooser (flow single lama).
      if (state.screen !== 'resultchooser') return state
      const r = action.result
      return { screen: 'framechooser', aiUrl: r.aiUrl, originalUrl: r.originalUrl, sourceUrl: r.sourceUrl, rawAiUrl: r.rawAiUrl, base: r.base, processingSec: r.processingSec, templateId: r.templateId }
    }

    case 'GO_FACE_ASSIGN':
      if (state.screen !== 'faceassign') return state
      return { ...state, faces: action.faces, templateSlots: action.templateSlots, assignments: {} }

    case 'ASSIGN_FACE':
      if (state.screen !== 'faceassign') return state
      return { ...state, assignments: { ...state.assignments, [action.faceId]: action.slotId } }

    case 'UNASSIGN_FACE': {
      if (state.screen !== 'faceassign') return state
      const { [action.faceId]: _, ...rest } = state.assignments
      return { ...state, assignments: rest }
    }

    case 'NEXT_FACE_ASSIGN': {
      if (state.screen !== 'faceassign') return state
      return {
        ...state,
        currentTemplateIndex: state.currentTemplateIndex + 1,
        assignments: {},
        templateSlots: [], // reset so effect re-detects for the new template
        allMappings: [...state.allMappings, action.mappings]
      }
    }

    case 'START_PROCESSING':
      // Template comfy skip FaceAssign — NEXT di TemplateScreen langsung ke processing.
      // Comfy TIDAK pernah multi-select → cuma jalur single (selected.length === 1).
      // Guard engine_type: defense-in-depth, non-comfy wajib lewat faceassign.
      if (state.screen === 'template' && state.selected.length === 1 && state.selected[0].engine_type === 'comfy')
        return { screen: 'processing', progress: 0, step: 1, imageUrl: state.imageUrl, templates: state.selected, assignments: {} }
      // Photo Print: multicapture selesai → processing bawa semua shot (compose lokal, bukan AI)
      if (state.screen === 'multicapture') {
        if (state.shots.length === 0) return state
        return { screen: 'processing', progress: 0, step: 1, imageUrl: state.shots[0], templates: [state.template], assignments: {}, shots: state.shots }
      }
      if (state.screen !== 'faceassign' || state.templates.length === 0) return state
      return { screen: 'processing', progress: 0, step: 1, imageUrl: state.imageUrl, templates: state.templates, faceMappings: action.faceMappings }

    case 'SET_PROGRESS': {
      if (state.screen !== 'processing') return state
      const step = action.progress < 34 ? 1 : action.progress < 67 ? 2 : 3
      return { ...state, progress: action.progress, step: step as 1 | 2 | 3 }
    }

    case 'SHOW_PREVIEW':
      // direct (Photo Print): overlay udah dibakar di composite — skip framechooser yang
      // auto-preselect frame (bakal numpuk PNG kedua di print+upload). selectedFrame null.
      if (action.direct)
        return { screen: 'preview', aiUrl: action.aiUrl, originalUrl: action.originalUrl, sourceUrl: action.sourceUrl, rawAiUrl: action.rawAiUrl, base: action.base, processingSec: action.processingSec, selectedFrame: null, videoUrl: action.videoUrl, printSize: action.printSize, templateId: action.templateId }
      // Landing di frame chooser dulu — tamu pilih frame, baru NEXT ke preview (upload+print).
      // videoUrl = hasil video engine (opsional) — kebawa terus sampai preview buat tab Video.
      return { screen: 'framechooser', aiUrl: action.aiUrl, originalUrl: action.originalUrl, sourceUrl: action.sourceUrl, rawAiUrl: action.rawAiUrl, base: action.base, processingSec: action.processingSec, videoUrl: action.videoUrl, templateId: action.templateId }

    case 'CONFIRM_FRAME':
      if (state.screen !== 'framechooser') return state
      return { screen: 'preview', aiUrl: state.aiUrl, originalUrl: state.originalUrl, sourceUrl: state.sourceUrl, rawAiUrl: state.rawAiUrl, base: state.base, processingSec: state.processingSec, selectedFrame: action.frame, videoUrl: state.videoUrl, templateId: state.templateId }

    case 'GO_DELIVERY':
      if (state.screen !== 'preview') return state
      return { screen: 'delivery', aiUrl: action.aiUrl, originalUrl: action.originalUrl, uploadAiUrl: action.uploadAiUrl, uploadOriginalUrl: action.uploadOriginalUrl, base: state.base, processingSec: state.processingSec }

    case 'SET_R2_URLS':
      if (state.screen !== 'delivery') return state
      return { ...state, r2OriginalUrl: action.r2OriginalUrl, r2AiUrl: action.r2AiUrl }

    case 'SELECT_FRAME':
      if (state.screen !== 'preview') return state
      return { ...state, selectedFrame: action.frame }

    case 'BACK':
      if (state.screen === 'consent') return { screen: 'idle' }
      if (state.screen === 'liveview') return { screen: 'idle' }
      if (state.screen === 'category') return { screen: 'liveview' }
      // Flow print (imageUrl '' — belum ada foto): BACK dari pemilih layout = pulang ke idle
      if (state.screen === 'template') return state.imageUrl === '' ? { screen: 'idle' } : { screen: 'category', imageUrl: state.imageUrl, selected: state.selected }
      if (state.screen === 'multicapture') return { screen: 'template', imageUrl: '', category: '', selected: [] }
      if (state.screen === 'faceassign') {
        if (state.currentTemplateIndex > 0) {
          return { ...state, currentTemplateIndex: state.currentTemplateIndex - 1, assignments: {}, templateSlots: [] }
        }
        return { screen: 'template', imageUrl: state.imageUrl, category: state.category, selected: state.templates }
      }
      // resultchooser BACK = restart ke idle — re-run N swap ga aman, hasil udah ke-save lokal.
      if (state.screen === 'resultchooser') return { screen: 'idle' }
      // Re-edit pakai selfie BERSIH — originalUrl bisa ke-watermark (freemium) → face crop di FaceAssign kebawa watermark.
      if (state.screen === 'framechooser') return { screen: 'category', imageUrl: state.sourceUrl ?? state.originalUrl }
      // Preview BACK ("Ganti Pilihan") = re-pilih TEMPLATE → balik ke category (pintu pilih template).
      // Pakai selfie BERSIH (sourceUrl) — originalUrl bisa ke-watermark (freemium) → face crop kebawa watermark.
      // Print: composite bukan selfie — balik ke pemilih layout, bukan category.
      if (state.screen === 'preview') {
        if (state.printSize) return { screen: 'template', imageUrl: '', category: '', selected: [] }
        return { screen: 'category', imageUrl: state.sourceUrl ?? state.originalUrl }
      }
      return state

    case 'RESET':
      return { screen: 'idle' }

    case 'SET_STATE':
      return action.state

    case 'FORCE_LOCKED':
      return { screen: 'force_locked', reason: action.reason, message: action.message }

    default:
      return state
  }
}

import type { KioskState, KioskAction } from './types'

export const initialState: KioskState = { screen: 'idle' }

export function kioskReducer(state: KioskState, action: KioskAction): KioskState {
  switch (action.type) {
    case 'START':
      return { screen: 'consent' }

    case 'CONSENT_GIVEN':
      if (state.screen !== 'consent') return state
      return { screen: 'liveview' }

    case 'CAPTURE':
      if (state.screen !== 'liveview') return state
      return { screen: 'category', imageUrl: action.imageUrl }

    case 'SELECT_CATEGORY':
      if (state.screen !== 'category') return state
      return { screen: 'template', imageUrl: state.imageUrl, category: action.category, selected: null }

    case 'SELECT_TEMPLATE':
      if (state.screen !== 'template') return state
      return { ...state, selected: action.template }

    case 'CONFIRM_TEMPLATE':
      if (state.screen !== 'template' || !state.selected) return state
      return { screen: 'faceassign', imageUrl: state.imageUrl, category: state.category, template: state.selected, faces: [], templateSlots: [], assignments: {} }

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

    case 'START_PROCESSING':
      if (state.screen !== 'faceassign' || !state.template) return state
      return { screen: 'processing', progress: 0, step: 1, imageUrl: state.imageUrl, template: state.template, assignments: state.assignments }

    case 'SET_PROGRESS': {
      if (state.screen !== 'processing') return state
      const step = action.progress < 34 ? 1 : action.progress < 67 ? 2 : 3
      return { ...state, progress: action.progress, step: step as 1 | 2 | 3 }
    }

    case 'SHOW_PREVIEW':
      return { screen: 'preview', aiUrl: action.aiUrl, originalUrl: action.originalUrl, sourceUrl: action.sourceUrl, selectedFrame: null }

    case 'SET_R2_URLS':
      if (state.screen !== 'preview') return state
      return { ...state, r2OriginalUrl: action.r2OriginalUrl, r2AiUrl: action.r2AiUrl }

    case 'SELECT_FRAME':
      if (state.screen !== 'preview') return state
      return { ...state, selectedFrame: action.frame }

    case 'BACK':
      if (state.screen === 'consent') return { screen: 'idle' }
      if (state.screen === 'liveview') return { screen: 'idle' }
      if (state.screen === 'category') return { screen: 'liveview' }
      if (state.screen === 'template') return { screen: 'category', imageUrl: state.imageUrl }
      if (state.screen === 'faceassign') return { screen: 'template', imageUrl: state.imageUrl, category: state.category, selected: null }
      // Re-edit pakai selfie BERSIH — originalUrl bisa ke-watermark (freemium) → face crop di FaceAssign kebawa watermark.
      if (state.screen === 'preview') return { screen: 'category', imageUrl: state.sourceUrl ?? state.originalUrl }
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

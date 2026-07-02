import { describe, it, expect } from 'vitest'
import { kioskReducer, initialState } from '@/lib/reducer'
import type { Template, Face, FaceSlot } from '@/lib/types'

const tmpl: Template = { id: 't1', name: 'Cyber', category: 'faceswap', token_cost: 2, thumbnail_url: '/t.jpg', gender_filter: 'ALL', engine_type: 'faceswap', positive_prompt: null, negative_prompt: null, api_endpoint: null, video_endpoint: null, video_positive_prompt: null, video_negative_prompt: null }
const face: Face = { id: '0', x: 10, y: 20, w: 50, h: 50 }
const slot: FaceSlot = { id: 'slot_0', x: 30, y: 40, w: 50, h: 50 }

const faceassignState = {
  screen: 'faceassign' as const,
  imageUrl: '/img.jpg',
  category: 'faceswap',
  template: tmpl,
  faces: [face],
  templateSlots: [slot],
  assignments: {},
}

describe('initialState', () => {
  it('is idle', () => expect(initialState).toEqual({ screen: 'idle' }))
})

describe('START', () => {
  it('idle → consent', () => {
    expect(kioskReducer({ screen: 'idle' }, { type: 'START' }))
      .toEqual({ screen: 'consent' })
  })
})

describe('CONSENT_GIVEN', () => {
  it('consent → liveview', () => {
    expect(kioskReducer({ screen: 'consent' }, { type: 'CONSENT_GIVEN' }))
      .toEqual({ screen: 'liveview' })
  })
})

describe('CAPTURE', () => {
  it('liveview → category', () => {
    expect(kioskReducer({ screen: 'liveview' }, { type: 'CAPTURE', imageUrl: '/img.jpg' }))
      .toEqual({ screen: 'category', imageUrl: '/img.jpg' })
  })
})

describe('SELECT_CATEGORY', () => {
  it('category → template', () => {
    const s = { screen: 'category' as const, imageUrl: '/img.jpg' }
    expect(kioskReducer(s, { type: 'SELECT_CATEGORY', category: 'faceswap' }))
      .toMatchObject({ screen: 'template', category: 'faceswap', imageUrl: '/img.jpg' })
  })
})

describe('GO_FACE_ASSIGN', () => {
  it('faceassign → faceassign with faces/slots', () => {
    expect(kioskReducer(faceassignState, { type: 'GO_FACE_ASSIGN', faces: [face], templateSlots: [slot] }))
      .toMatchObject({ screen: 'faceassign', imageUrl: '/img.jpg', faces: [face], templateSlots: [slot], assignments: {} })
  })
})

describe('ASSIGN_FACE', () => {
  it('adds assignment faceId → slotId', () => {
    expect(kioskReducer(faceassignState, { type: 'ASSIGN_FACE', faceId: '0', slotId: 'slot_0' }))
      .toMatchObject({ assignments: { '0': 'slot_0' } })
  })
})

describe('UNASSIGN_FACE', () => {
  it('removes assignment', () => {
    const s = { ...faceassignState, assignments: { '0': 'slot_0' } }
    expect(kioskReducer(s, { type: 'UNASSIGN_FACE', faceId: '0' }))
      .toMatchObject({ assignments: {} })
  })
})

describe('START_PROCESSING', () => {
  it('faceassign → processing carrying imageUrl/template/assignments', () => {
    const s = { ...faceassignState, assignments: { '0': 'slot_0' } }
    expect(kioskReducer(s, { type: 'START_PROCESSING' }))
      .toEqual({ screen: 'processing', progress: 0, step: 1, imageUrl: '/img.jpg', template: tmpl, assignments: { '0': 'slot_0' } })
  })
  it('no-op from non-faceassign screen', () => {
    const s = { screen: 'category' as const, imageUrl: '' }
    expect(kioskReducer(s, { type: 'START_PROCESSING' })).toBe(s)
  })
})

describe('SET_PROGRESS', () => {
  const proc = { screen: 'processing' as const, progress: 0, step: 1 as const, imageUrl: '', template: tmpl, assignments: {} }
  it('0–33 = step 1', () => expect(kioskReducer(proc, { type: 'SET_PROGRESS', progress: 20 })).toMatchObject({ step: 1 }))
  it('34–66 = step 2', () => expect(kioskReducer(proc, { type: 'SET_PROGRESS', progress: 50 })).toMatchObject({ step: 2 }))
  it('67–100 = step 3', () => expect(kioskReducer(proc, { type: 'SET_PROGRESS', progress: 80 })).toMatchObject({ step: 3 }))
})

describe('SHOW_PREVIEW', () => {
  it('processing → preview', () => {
    const s = { screen: 'processing' as const, progress: 100, step: 3 as const, imageUrl: '', template: tmpl, assignments: {} }
    expect(kioskReducer(s, { type: 'SHOW_PREVIEW', aiUrl: '/ai.jpg', originalUrl: '/orig.jpg' }))
      .toEqual({ screen: 'preview', aiUrl: '/ai.jpg', originalUrl: '/orig.jpg', selectedFrame: null })
  })
})

describe('SELECT_FRAME', () => {
  const prev = { screen: 'preview' as const, aiUrl: '', originalUrl: '', selectedFrame: null }
  it('sets frame', () => {
    const f = { id: 'fr1', url: '/f.png' }
    expect(kioskReducer(prev, { type: 'SELECT_FRAME', frame: f })).toMatchObject({ selectedFrame: f })
  })
  it('clears frame', () => {
    const s = { ...prev, selectedFrame: { id: 'fr1', url: '/f.png' } }
    expect(kioskReducer(s, { type: 'SELECT_FRAME', frame: null })).toMatchObject({ selectedFrame: null })
  })
})

describe('RESET', () => {
  it('returns idle from any screen', () => {
    const states = [
      { screen: 'faceassign' as const, imageUrl: '', category: 'faceswap', template: null, faces: [], templateSlots: [], assignments: {} },
      { screen: 'processing' as const, progress: 50, step: 2 as const, imageUrl: '', template: tmpl, assignments: {} },
      { screen: 'preview' as const, aiUrl: '', originalUrl: '', selectedFrame: null },
    ]
    states.forEach(s => expect(kioskReducer(s, { type: 'RESET' })).toEqual({ screen: 'idle' }))
  })
})

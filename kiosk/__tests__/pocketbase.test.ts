import { describe, it, expect } from 'vitest'
import { mapPbTemplate } from '@/lib/pocketbase'

const PB = 'http://localhost:8090'

describe('mapPbTemplate', () => {
  it('builds thumbnail URL from filename', () => {
    const t = mapPbTemplate(PB, { id: 'abc123', name: 'Wedding', thumbnail: 'photo.jpg', category: 'Wedding', gender_filter: 'ALL', engine_type: 'faceswap', token_cost: 1 })
    expect(t.thumbnail_url).toBe(`${PB}/api/files/templates/abc123/photo.jpg`)
  })

  it('returns null thumbnail when field is empty', () => {
    const t = mapPbTemplate(PB, { id: 'x', name: 'T', thumbnail: null })
    expect(t.thumbnail_url).toBeNull()
  })

  it('defaults gender_filter to ALL', () => {
    const t = mapPbTemplate(PB, { id: 'x', name: 'T' })
    expect(t.gender_filter).toBe('ALL')
  })

  it('defaults engine_type to faceswap', () => {
    const t = mapPbTemplate(PB, { id: 'x', name: 'T' })
    expect(t.engine_type).toBe('faceswap')
  })

  it('sets api/video endpoints to null', () => {
    const t = mapPbTemplate(PB, { id: 'x', name: 'T' })
    expect(t.api_endpoint).toBeNull()
    expect(t.video_endpoint).toBeNull()
  })
})

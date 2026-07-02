import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/kiosk-config', () => ({
  fetchKioskConfig: vi.fn(),
}))

import { fetchKioskConfig } from '@/lib/kiosk-config'

const mockConfig = {
  event_name: 'Pesta Besar',
  brand_color: '#88c0d0',
  generation_source: 'fal' as const,
  templates: [],
  frames: [],
  enable_email: true,
  enable_print: true,
  enable_video: true,
  enable_gallery: false,
  video_defaults: { default_positive_prompt: '', default_negative_prompt: '', max_duration_sec: 7 },
}

describe('fetchKioskConfig', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns config object', async () => {
    vi.mocked(fetchKioskConfig).mockResolvedValue(mockConfig)
    const config = await fetchKioskConfig()
    expect(config.brand_color).toBe('#88c0d0')
  })

  it('exposes event_name', async () => {
    vi.mocked(fetchKioskConfig).mockResolvedValue(mockConfig)
    const config = await fetchKioskConfig()
    expect(config.event_name).toBe('Pesta Besar')
  })
})

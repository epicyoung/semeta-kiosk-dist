import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TemplateScreen } from '@/components/screens/TemplateScreen'
import type { Template } from '@/lib/types'

const BASE: Omit<Template, 'id' | 'name' | 'token_cost' | 'thumbnail_url'> = {
  category: 'faceswap', gender_filter: 'ALL', engine_type: 'faceswap',
  positive_prompt: null, negative_prompt: null, api_endpoint: null,
  video_endpoint: null, video_positive_prompt: null, video_negative_prompt: null,
}
const templates: Template[] = [
  { ...BASE, id: 't1', name: 'Cyber', token_cost: 2, thumbnail_url: '/t1.jpg' },
  { ...BASE, id: 't2', name: 'Anime', token_cost: 3, thumbnail_url: '/t2.jpg' },
]

// Templates with a thumbnail_url render as <img alt={name}>, not text.
// The confirm button reads t('nav_next') → "Next →" (default en locale, no provider needed).
describe('TemplateScreen', () => {
  it('shows all templates', () => {
    const state = { screen: 'template' as const, selected: null, category: 'faceswap', imageUrl: '' }
    render(<TemplateScreen state={state} dispatch={vi.fn()} templates={templates} />)
    expect(screen.getByAltText('Cyber')).toBeTruthy()
    expect(screen.getByAltText('Anime')).toBeTruthy()
  })

  it('Next disabled when nothing selected', () => {
    const state = { screen: 'template' as const, selected: null, category: 'faceswap', imageUrl: '' }
    render(<TemplateScreen state={state} dispatch={vi.fn()} templates={templates} />)
    const btn = screen.getByRole('button', { name: /next/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('dispatches SELECT_TEMPLATE on tap', () => {
    const dispatch = vi.fn()
    const state = { screen: 'template' as const, selected: null, category: 'faceswap', imageUrl: '' }
    render(<TemplateScreen state={state} dispatch={dispatch} templates={templates} />)
    fireEvent.click(screen.getByAltText('Cyber'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'SELECT_TEMPLATE', template: templates[0] })
  })

  it('Next enabled when template selected', () => {
    const state = { screen: 'template' as const, selected: templates[0], category: 'faceswap', imageUrl: '' }
    render(<TemplateScreen state={state} dispatch={vi.fn()} templates={templates} />)
    const btn = screen.getByRole('button', { name: /next/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it('dispatches CONFIRM_TEMPLATE on Next', () => {
    const dispatch = vi.fn()
    const state = { screen: 'template' as const, selected: templates[0], category: 'faceswap', imageUrl: '' }
    render(<TemplateScreen state={state} dispatch={dispatch} templates={templates} />)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'CONFIRM_TEMPLATE' })
  })
})

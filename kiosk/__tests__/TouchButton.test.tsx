import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TouchButton } from '@/components/ui/TouchButton'

describe('TouchButton', () => {
  it('renders children', () => {
    render(<TouchButton>Tap Me</TouchButton>)
    expect(screen.getByRole('button', { name: 'Tap Me' })).toBeTruthy()
  })

  it('calls onClick', () => {
    let clicked = false
    render(<TouchButton onClick={() => { clicked = true }}>Go</TouchButton>)
    fireEvent.click(screen.getByRole('button'))
    expect(clicked).toBe(true)
  })

  it('is disabled when disabled prop set', () => {
    render(<TouchButton disabled>Nope</TouchButton>)
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('has minimum height class for touch targets', () => {
    render(<TouchButton>Touch</TouchButton>)
    const btn = screen.getByRole('button')
    expect(btn.className).toContain('h-[72px]')
  })
})

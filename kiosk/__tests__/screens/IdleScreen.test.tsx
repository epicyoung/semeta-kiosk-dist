import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IdleScreen } from '@/components/screens/IdleScreen'

describe('IdleScreen', () => {
  it('renders without crashing', () => {
    render(<IdleScreen dispatch={vi.fn()} />)
    expect(screen.getByRole('button')).toBeTruthy()
  })

  it('dispatches START on tap', () => {
    const dispatch = vi.fn()
    render(<IdleScreen dispatch={dispatch} />)
    fireEvent.click(screen.getByRole('button'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'START' })
  })
})

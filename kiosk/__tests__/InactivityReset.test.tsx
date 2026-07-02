import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { InactivityReset } from '@/components/ui/InactivityReset'

describe('InactivityReset', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('renders children', () => {
    const dispatch = vi.fn()
    render(
      <InactivityReset screen="template" dispatch={dispatch}>
        <div>child</div>
      </InactivityReset>
    )
    expect(screen.getByText('child')).toBeTruthy()
  })

  it('does not show warning or dispatch RESET on idle screen', () => {
    const dispatch = vi.fn()
    render(
      <InactivityReset screen="idle" dispatch={dispatch}>
        <div>child</div>
      </InactivityReset>
    )
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('dispatches RESET after 60s on non-idle screen', () => {
    const dispatch = vi.fn()
    render(
      <InactivityReset screen="template" dispatch={dispatch}>
        <div>child</div>
      </InactivityReset>
    )
    act(() => { vi.advanceTimersByTime(60_001) })
    expect(dispatch).toHaveBeenCalledWith({ type: 'RESET' })
  })

  it('resets timer on pointer interaction', () => {
    const dispatch = vi.fn()
    render(
      <InactivityReset screen="template" dispatch={dispatch}>
        <div>child</div>
      </InactivityReset>
    )
    act(() => { vi.advanceTimersByTime(55_000) })
    fireEvent.pointerDown(document)
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'RESET' })
  })
})

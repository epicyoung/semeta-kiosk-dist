import { describe, it, expect, vi } from 'vitest'
import { printPhoto } from '@/lib/print'

// printPhoto prints via a hidden iframe (not window.open) and is async.
// A data: URL skips the fetch→dataURL branch, keeping the test deterministic.

describe('printPhoto', () => {
  it('writes the image into an iframe and calls print', async () => {
    const dataUrl = 'data:image/jpeg;base64,AAAA'
    const printSpy = vi.fn()
    const writeSpy = vi.fn()
    const realCreate = document.createElement.bind(document)

    // Intercept the iframe so we control its contentDocument.write /
    // contentWindow.print, and fire onload to resolve the internal load-wait.
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement
      if (tag === 'iframe') {
        const fakeDoc = { open: vi.fn(), write: writeSpy, close: vi.fn() }
        Object.defineProperty(el, 'contentDocument', { configurable: true, value: fakeDoc })
        Object.defineProperty(el, 'contentWindow', { configurable: true, value: { print: printSpy } })
        queueMicrotask(() => (el as HTMLIFrameElement).onload?.(new Event('load')))
      }
      return el
    })

    await printPhoto(dataUrl, 2)

    const written = writeSpy.mock.calls.map(c => String(c[0])).join('')
    expect(written).toContain(dataUrl)
    expect((written.match(/<img/g) || []).length).toBe(2)
    expect(printSpy).toHaveBeenCalled()

    vi.restoreAllMocks()
  })
})

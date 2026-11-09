import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GalleryPanel } from './GalleryPanel'

let host: HTMLDivElement
let root: Root
const entry = { seq: '001', session_id: 'test-20261031-001', created_at: '2026-10-31T10:00:00Z', print_path: 'master.jpg', thumb_path: 'thumb.jpg', variants: [{ id: 'v', created_at: '', label: '4R', master_file: 'master.jpg', thumbnail_file: 'thumb.jpg', width: 100, height: 150, recipe: 'single_4r' }] }
const response = (body: unknown) => ({ ok: true, json: async () => body })
beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

it('updates the selected photo QR after background upload without closing detail', async () => {
  let ready = false
  vi.stubGlobal('fetch', vi.fn(async () => response({ entries: [{ ...entry, share_url: ready ? 'https://photos.example/old-session' : undefined }], next_cursor: null })))
  await act(async () => root.render(<GalleryPanel guest eventName="Test" initialEventId="test-20261031" initialSessionId={entry.session_id} onClose={() => {}} />))
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  expect(host.querySelector('svg')).toBeNull()
  ready = true
  await act(async () => { await vi.advanceTimersByTimeAsync(3500) })
  expect(host.querySelector('svg')).not.toBeNull()
  expect(host.textContent).toContain('Foto #001')
})

it('isolates controls behind the modal from pointer and keyboard focus', async () => {
  const background = document.createElement('button'); background.textContent = 'Background'; document.body.append(background)
  vi.stubGlobal('fetch', vi.fn(async () => response({ entries: [], next_cursor: null })))
  await act(async () => root.render(<GalleryPanel guest eventName="Test" onClose={() => {}} />))
  expect(background.hasAttribute('inert')).toBe(true)
})

it('does not append stale pagination from the previous event', async () => {
  let resolvePage!: (value: ReturnType<typeof response>) => void
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('events=1')) return response({ events: [{ id: 'test-20261031', name: 'Test' }, { id: 'other-20261031', name: 'Other' }] })
    if (url.includes('cursor=')) return new Promise<ReturnType<typeof response>>(resolve => { resolvePage = resolve })
    if (url.includes('other-20261031')) return response({ entries: [], next_cursor: null })
    return response({ entries: [entry], next_cursor: '001' })
  }))
  await act(async () => root.render(<GalleryPanel eventName="Test" initialEventId="test-20261031" onClose={() => {}} />))
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  const more = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Muat Lagi')!
  await act(async () => more.click())
  const eventSelect = host.querySelector('select')!
  expect(Array.from(eventSelect.options).map(option => option.value)).toContain('other-20261031')
  await act(async () => { eventSelect.value = 'other-20261031'; eventSelect.dispatchEvent(new Event('change', { bubbles: true })); await vi.advanceTimersByTimeAsync(250) })
  await act(async () => resolvePage(response({ entries: [{ ...entry, seq: '999', session_id: 'test-20261031-999' }], next_cursor: null })))
  expect(host.textContent).not.toContain('#999')
})

it('does not extend guest inactivity just because the parent rerenders', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ entries: [], next_cursor: null })))
  const closed = vi.fn()
  for (let index = 0; index < 4; index++) {
    await act(async () => root.render(<GalleryPanel guest eventName="Test" onClose={() => closed()} />))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  }
  expect(closed).toHaveBeenCalledTimes(1)
})

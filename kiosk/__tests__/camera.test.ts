import { describe, it, expect, vi } from 'vitest'

const track = { stop: vi.fn() }
const mockStream = { getTracks: () => [track] }

Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(mockStream) } },
  writable: true,
})

import { startCamera, stopCamera } from '@/lib/camera'

describe('startCamera', () => {
  it('calls getUserMedia with video:true, audio:false', async () => {
    const videoEl = { srcObject: null as any, play: vi.fn() } as any
    await startCamera(videoEl)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: false })
    expect(videoEl.srcObject).toBe(mockStream)
  })
})

describe('stopCamera', () => {
  it('calls stop on all tracks via el.srcObject', () => {
    track.stop.mockClear()
    const videoEl = { srcObject: mockStream as any } as any
    stopCamera(videoEl)
    expect(track.stop).toHaveBeenCalled()
  })
})

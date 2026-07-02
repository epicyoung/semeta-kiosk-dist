import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import { eventFolder, padSeq, originalFilename, aiFilename, nextSeq } from '@/lib/event'

const D = new Date('2026-06-25T00:00:00Z')

describe('eventFolder', () => {
  it('kebab-lowercase and appends YYYYMMDD', () => {
    expect(eventFolder('Wedding Budi!', D)).toBe('wedding-budi-20260625')
  })

  it('collapses separators to single hyphen', () => {
    expect(eventFolder('Ulang-Tahun #50', D)).toBe('ulang-tahun-50-20260625')
  })

  it('fun run example', () => {
    expect(eventFolder('Fun Run', D)).toBe('fun-run-20260625')
  })

  it('falls back to event for empty string', () => {
    expect(eventFolder('', D)).toBe('event-20260625')
  })

  it('falls back to event for symbols-only string', () => {
    expect(eventFolder('!!!', D)).toBe('event-20260625')
  })
})

describe('padSeq', () => {
  it('pads single digit', () => { expect(padSeq(1)).toBe('001') })
  it('pads double digit', () => { expect(padSeq(42)).toBe('042') })
  it('does not truncate triple digit', () => { expect(padSeq(123)).toBe('123') })
})

describe('originalFilename', () => {
  it('follows naming convention', () => {
    expect(originalFilename('Wedding Budi', '001', 'B', D))
      .toBe('wedding-budi-20260625-001-B-ori-semeta.jpg')
  })
  it('A variant', () => {
    expect(originalFilename('Demo', '007', 'A', D))
      .toBe('demo-20260625-007-A-ori-semeta.jpg')
  })
})

describe('aiFilename', () => {
  it('follows naming convention', () => {
    expect(aiFilename('Wedding Budi', '042', 'A', D))
      .toBe('wedding-budi-20260625-042-A-ai-semeta.jpg')
  })
})

describe('nextSeq', () => {
  let mkdirSpy: any
  let readFileSpy: any
  let writeFileSpy: any

  beforeEach(() => {
    mkdirSpy = vi.spyOn(fs, 'mkdirSync')
    readFileSpy = vi.spyOn(fs, 'readFileSync')
    writeFileSpy = vi.spyOn(fs, 'writeFileSync')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 1 and creates file when seq.json missing', () => {
    mkdirSpy.mockReturnValue(undefined as any)
    readFileSpy.mockImplementation(() => { throw new Error('ENOENT') })
    writeFileSpy.mockReturnValue(undefined as any)

    const n = nextSeq('fun-run-20260625')
    expect(n).toBe(1)
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('fun-run-20260625'),
      JSON.stringify({ seq: 1 }, null, 2)
    )
  })

  it('increments existing counter', () => {
    mkdirSpy.mockReturnValue(undefined as any)
    readFileSpy.mockReturnValue('{"seq":5}')
    writeFileSpy.mockReturnValue(undefined as any)

    const n = nextSeq('fun-run-20260625')
    expect(n).toBe(6)
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('fun-run-20260625'),
      JSON.stringify({ seq: 6 }, null, 2)
    )
  })

  it('different event folders are independent', () => {
    mkdirSpy.mockReturnValue(undefined as any)
    readFileSpy.mockImplementation(() => { throw new Error('ENOENT') })
    writeFileSpy.mockReturnValue(undefined as any)

    const n1 = nextSeq('event1-20260625')
    const n2 = nextSeq('event2-20260625')

    expect(n1).toBe(1)
    expect(n2).toBe(1)
    expect(mkdirSpy).toHaveBeenCalledTimes(2)
  })
})

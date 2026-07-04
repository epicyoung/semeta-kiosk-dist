import { useEffect, useState } from 'react'
import { proxied } from './facedetect'
import type { Frame } from './types'

export type Orientation = 'portrait' | 'landscape'
export type OrientedFrame = Frame & { orientation: Orientation }

// Square -> portrait: status quo (semua frame lama 2:3) — jangan bikin pool landscape kepolusi.
export function orientationOf(w: number, h: number): Orientation {
  return w > h ? 'landscape' : 'portrait'
}

// Frame buat Original pas mismatch: ambil frame PERTAMA dengan orientasi yang dibutuhin
// (bukan yang lagi dipilih). Generik dua arah — Ori landscape → cari landscape (P+L), Ori
// portrait → cari portrait (L+P, pas AI landscape). No pairing by-nama: operator upload bebas.
// Ga ada frame orientasi itu = null (Original polos, foto tetap uncrop). Lihat spec 2026-07-04.
export function findOverlayForOrientation(
  frames: OrientedFrame[],
  chosen: OrientedFrame | null,
  want: Orientation,
): OrientedFrame | null {
  return frames.find(f => f.id !== chosen?.id && f.orientation === want) ?? null
}

// Client-only. null saat gagal load (frame rusak / offline) — caller treats as portrait.
export function loadImageDims(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise(resolve => {
    const im = new Image()
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight })
    im.onerror = () => resolve(null)
    im.src = proxied(url)
  })
}

// Ukur <=10 frame sekali per pool. Sebelum kelar: default portrait (= perilaku lama, no flash).
export function useOrientedFrames(frames: Frame[]): OrientedFrame[] {
  const [oriented, setOriented] = useState<OrientedFrame[]>(
    () => frames.map(f => ({ ...f, orientation: 'portrait' as Orientation })),
  )
  useEffect(() => {
    let cancelled = false
    Promise.all(frames.map(async f => {
      const dims = await loadImageDims(f.url)
      return { ...f, orientation: dims ? orientationOf(dims.w, dims.h) : 'portrait' as Orientation }
    })).then(result => { if (!cancelled) setOriented(result) })
    return () => { cancelled = true }
  }, [frames])
  return oriented
}

export async function startCamera(el: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  el.srcObject = stream
  await el.play()
  return stream
}

export function stopCamera(el: HTMLVideoElement): void {
  const stream = el.srcObject as MediaStream | null
  stream?.getTracks().forEach(t => t.stop())
  el.srcObject = null
}

// Canon DSLR: jepret full-res lewat backend /api/canon-capture. Backend yang ngomong ke
// digiCamControl 5513 (bebas CORS) + baca file kamera → balikin dataURL JPEG full-res.
// Dipake pas camera_source === 'canon' (LiveView + MultiCapture), gantiin canvas-dari-webcam.
export async function triggerCanonCapture(): Promise<string> {
  const res = await fetch('/api/canon-capture', { method: 'POST' })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: `capture ${res.status}` }))
    throw new Error(error ?? `capture ${res.status}`)
  }
  const { dataUrl } = await res.json()
  if (!dataUrl) throw new Error('capture: no image')
  return dataUrl as string
}

// Quarter-turn (90/270) swap w↔h; 0/180 keep. Pure — testable tanpa DOM.
export function rotatedCanvasSize(w: number, h: number, deg: number): { w: number; h: number } {
  return deg === 90 || deg === 270 ? { w: h, h: w } : { w, h }
}

// Rotate dataURL image by 0/90/180/270 via canvas. Canon capture balik dataURL JADI (bukan
// video frame) → rotasi CSS live preview ga ke-apply ke hasil. Ini yang bikin DSLR bisa diputer
// kayak webcam. deg 0 → passthrough (no canvas cost).
export async function rotateDataUrl(dataUrl: string, deg: number): Promise<string> {
  if (deg % 360 === 0) return dataUrl
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('rotateDataUrl: image load failed'))
    img.src = dataUrl
  })
  const { w, h } = rotatedCanvasSize(img.naturalWidth, img.naturalHeight, deg)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.translate(w / 2, h / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  return canvas.toDataURL('image/jpeg', 0.92)
}

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
// kayak webcam.
//
// ⚠️ EXIF FIX (2026-07-21): Canon DSLR yg dipasang miring/gantung NULIS EXIF orientation tag ke
// JPEG. Preview <img> di layar AUTO-apply EXIF → keliatan tegak. TAPI <canvas>.drawImage() +
// new Image() bisa NGABAIN EXIF (atau naturalWidth/Height mentah pre-EXIF) → hasil capture MIRING
// 90° dari preview, dan canvas STRIP EXIF jadi ga ada tag buat betulin lagi. Foto miring ini yg
// ke-upload → overlay/frame tegak numpuk di atasnya = "overlay ga masuk".
//
// Fix: createImageBitmap(blob, {imageOrientation:'from-image'}) MEMAKSA EXIF ter-bake ke pixel
// bitmap (persis kayak <img> preview) → capture == preview. Rotasi manual operator lalu di-apply
// DI ATAS orientasi yg udah bener. deg 0 pun WAJIB lewat sini (bake EXIF), bukan passthrough —
// passthrough dataURL mentah = EXIF masih nempel = tetep miring di konsumen yg ga apply EXIF.
export async function rotateDataUrl(dataUrl: string, deg: number): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  // imageOrientation:'from-image' → browser apply EXIF orientation ke pixel. bitmap.width/height
  // udah POST-orient (dimensi visual bener), beda dari new Image().naturalWidth yg bisa pre-EXIF.
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    // Fallback (browser lama tanpa opsi imageOrientation): decode biasa. Minimal ga crash;
    // EXIF mungkin ga ter-bake tapi flow tetep jalan.
    bitmap = await createImageBitmap(blob)
  }
  const srcW = bitmap.width
  const srcH = bitmap.height
  const { w, h } = rotatedCanvasSize(srcW, srcH, deg)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.translate(w / 2, h / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(bitmap, -srcW / 2, -srcH / 2)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.92)
}

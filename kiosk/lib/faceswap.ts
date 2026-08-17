import { proxied } from './facedetect'

const FACE_SERVER = 'http://localhost:8000'

/** dataUrl atau URL biasa → Blob. Cross-origin (R2) lewat proxy same-origin biar ga kena CORS. */
export async function toBlob(url: string): Promise<Blob> {
  if (url.startsWith('data:')) {
    const [header, b64] = url.split(',')
    const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg'
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return new Blob([arr], { type: mime })
  }
  const res = await fetch(proxied(url))
  return res.blob()
}

/** face_server nyala? Timeout 500ms — pola sama kayak resolveProvider di facedetect.ts.
 *  Dipake buat matiin tombol Edit Wajah SEBELUM tamu nekan, bukan bikin dia nunggu terus gagal. */
export async function isFaceServerAlive(): Promise<boolean> {
  try {
    const r = await fetch(`${FACE_SERVER}/health`, { signal: AbortSignal.timeout(500) })
    return r.ok
  } catch {
    return false
  }
}

/** Tempel muka dari `selfieUrl` ke muka di `templateUrl`. Balikin data URL hasil.
 *
 *  Dipake dua jalur: generate awal (ProcessingScreen) dan edit ulang hasil AI (PreviewScreen).
 *  `faceMapping` = indeks muka selfie per muka template; absen ⇒ server swap semua urut L-R. */
export async function swapFace(
  templateUrl: string,
  selfieUrl: string,
  onProgress: (pct: number) => void,
  faceMapping?: (number | null)[],
): Promise<string> {
  onProgress(10)
  const [templateBlob, selfieBlob] = await Promise.all([toBlob(templateUrl), toBlob(selfieUrl)])
  onProgress(30)
  const fd = new FormData()
  fd.append('template', templateBlob, 'template.jpg')
  fd.append('selfie', selfieBlob, 'selfie.jpg')
  // Assignment dari FaceAssign — face_server swap tiap muka sesuai ini. Absen → server default swap semua L-R.
  if (faceMapping && faceMapping.length > 0) fd.append('mapping', JSON.stringify(faceMapping))
  onProgress(50)
  const res = await fetch(`${FACE_SERVER}/swap`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`face_server /swap: ${res.status}`)
  onProgress(85)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

const MAX_PX = 1200 // longest edge for B uploads — fits IG/WA story portrait, phones top out ~1440px

/** Upload a photo/video to R2 via the Next.js API route. Returns { url, key }. */
export async function uploadAsset(
  dataUrlOrUrl: string,
  type: "A" | "B" | "C",
  sessionId: string,
): Promise<{ url: string; key: string }> {
  const blob = type === "C"
    ? await toBlob(dataUrlOrUrl)
    : await resizeBlob(dataUrlOrUrl, MAX_PX)

  const ext = type === "C" ? "mp4" : "jpg"
  const form = new FormData()
  form.append("type", type)
  form.append("session_id", sessionId)
  form.append("file", blob, `photo.${ext}`)

  // Watermark is decided server-side from the rental session — client has no say.
  const res = await fetch("/api/upload-asset", {
    method: "POST",
    body: form,
  })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  const { url, key } = await res.json()
  return { url, key }
}

/** Resize image so longest edge ≤ maxPx, returns JPEG blob. Skips resize if already small enough. */
async function resizeBlob(dataUrlOrUrl: string, maxPx: number): Promise<Blob> {
  const src = await toBlob(dataUrlOrUrl)
  const bitmap = await createImageBitmap(src)
  const { width, height } = bitmap

  if (width <= maxPx && height <= maxPx) {
    bitmap.close()
    return src
  }

  const scale = maxPx / Math.max(width, height)
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)

  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 })
}

async function toBlob(dataUrlOrUrl: string): Promise<Blob> {
  if (dataUrlOrUrl.startsWith("data:")) {
    const [header, b64] = dataUrlOrUrl.split(",")
    const mime = header.match(/:(.*?);/)?.[1] ?? "image/jpeg"
    const bytes = atob(b64)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    return new Blob([arr], { type: mime })
  }
  const res = await fetch(dataUrlOrUrl)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  return res.blob()
}
